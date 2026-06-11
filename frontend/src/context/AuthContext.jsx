// src/context/AuthContext.jsx
//
// BEHAVIOR:
//
// ┌─ LOGIN ────────────────────────────────────────────────────────────┐
// │  Backend always runs a full sync before returning the JWT.         │
// │  Frontend waits for JWT, then loads all data from MongoDB.         │
// └────────────────────────────────────────────────────────────────────┘
//
// ┌─ BROWSER REFRESH (hydrateUser) ────────────────────────────────────┐
// │  1. Restore user from JWT (GET /auth/me).                          │
// │  2. Call POST /portfolio/refresh — updates portfolio LTP in DB.    │
// │  3. Load all other data (shares, wacc, issues) from MongoDB.       │
// │                                                                    │
// │  If MeroShare session expired:                                     │
// │    → Backend returns 401 { sessionExpired: true }                  │
// │    → apiFetch dispatches "meroshare:sessionExpired" DOM event      │
// │    → AuthContext listener calls logout() → redirects to login      │
// └────────────────────────────────────────────────────────────────────┘
//
// ┌─ SESSION EXPIRY (any API call) ───────────────────────────────────┐
// │  Any 401 + sessionExpired from any endpoint triggers logout.       │
// │  The "meroshare:sessionExpired" DOM event is the signal.           │
// └────────────────────────────────────────────────────────────────────┘
//
import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { loginApi, getMeApi, logoutApi } from "../api/auth";
import {
  getPortfolio, getShares, getIssues, getWacc,
  refreshPortfolio,
  getSyncLogs,
  getJournalTrades, createJournalTrade, updateJournalTrade, deleteJournalTrade,
  getInvestmentTrades, createInvestmentTrade, updateInvestmentTrade, deleteInvestmentTrade,
} from "../api/meroshare";

const AuthContext = createContext(null);
const TOKEN_KEY   = "kitakat_token";

export function AuthProvider({ children }) {
  const [token, setToken]                   = useState(() => sessionStorage.getItem(TOKEN_KEY) || null);
  const [user,  setUser]                    = useState(null);
  const [loading,        setLoading]        = useState(false);
  const [syncLoading,    setSyncLoading]    = useState(false);
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [error,          setError]          = useState(null);

  // Prevents hydrateUser running more than once per page load
  const hydratedRef = useRef(false);

  // Cached portfolio-level data (shared across all tabs)
  const [portfolioData, setPortfolioData] = useState({
    portfolio:  null,
    shares:     [],
    wacc:       [],
    issues:     [],
    loaded:     false,
  });

  // ── logout ───────────────────────────────────────────────────────────
  // Clears local session AND notifies the backend to clear meroshareToken.
  const logout = useCallback(async (currentToken) => {
    const tok = currentToken || sessionStorage.getItem(TOKEN_KEY);
    // Clear local state first so UI redirects immediately
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setError(null);
    hydratedRef.current = false;
    setPortfolioData({ portfolio: null, shares: [], wacc: [], issues: [], loaded: false });

    // Best-effort: tell backend to clear the stored MeroShare token
    if (tok) {
      try { await logoutApi(tok); } catch (_) { /* ignore */ }
    }
  }, []);

  // ── Listen for session expiry from any API call ───────────────────
  // apiFetch dispatches this event whenever it receives 401+sessionExpired.
  // This catches expiry from refreshPortfolio AND any other protected endpoint.
  useEffect(() => {
    const handleSessionExpired = () => {
      console.warn("⚠️  MeroShare session expired — logging out and redirecting to login.");
      logout();
    };
    window.addEventListener("meroshare:sessionExpired", handleSessionExpired);
    return () => window.removeEventListener("meroshare:sessionExpired", handleSessionExpired);
  }, [logout]);

  // ── Load all data from MongoDB ───────────────────────────────────────
  const loadStaticData = useCallback(async (tok, portfolioOverride = null) => {
    const t = tok || token;
    if (!t) return;
    try {
      const [portfolio, shares, wacc, issues] = await Promise.all([
        portfolioOverride ? Promise.resolve(portfolioOverride) : getPortfolio(t),
        getShares(t),
        getWacc(t),
        getIssues(t),
      ]);
      setPortfolioData({
        portfolio: portfolio || null,
        shares:    Array.isArray(shares) ? shares : (shares?.data || []),
        wacc:      Array.isArray(wacc)   ? wacc   : (wacc?.data   || []),
        issues:    Array.isArray(issues) ? issues : (issues?.data  || []),
        loaded:    true,
      });
    } catch (e) {
      console.warn("loadStaticData failed:", e.message);
      setPortfolioData(prev => ({ ...prev, loaded: true }));
    }
  }, [token]);

  const fetchAllPortfolioData = loadStaticData;

  // ── login ────────────────────────────────────────────────────────────
  // Backend runs full sync before returning JWT — always.
  // Frontend shows syncLoading spinner while waiting, then loads from DB.
  const login = useCallback(async ({ dpCode, username, password }) => {
    setLoading(true);
    setSyncLoading(true);
    setError(null);
    hydratedRef.current = false;
    try {
      const data = await loginApi({ dpCode: String(dpCode), username, password });
      const tok  = data.token;

      sessionStorage.setItem(TOKEN_KEY, tok);
      setToken(tok);
      setUser(data.user);

      try {
        await loadStaticData(tok);
      } finally {
        setSyncLoading(false);
      }

      hydratedRef.current = true;
      return true;
    } catch (e) {
      setError(e.message);
      setSyncLoading(false);
      return false;
    } finally {
      setLoading(false);
    }
  }, [loadStaticData]);

  // ── hydrateUser: called on every page/browser refresh ───────────────
  //
  // Runs ONCE per page load (hydratedRef guard).
  //
  // If portfolio refresh returns 401+sessionExpired:
  //   → apiFetch dispatches "meroshare:sessionExpired"
  //   → The event listener above calls logout()
  //   → User is redirected to login page
  //
  const hydrateUser = useCallback(async () => {
    const storedToken = sessionStorage.getItem(TOKEN_KEY);
    if (!storedToken) return;
    if (hydratedRef.current) return;

    hydratedRef.current = true;

    try {
      const me = await getMeApi(storedToken);
      setUser(me);
    } catch {
      logout();
      return;
    }

    setRefreshLoading(true);
    let freshPortfolio = null;

    try {
      freshPortfolio = await refreshPortfolio(storedToken);
      console.log("✅ Portfolio refresh complete (LTP updated).");
    } catch (refreshErr) {
      if (refreshErr.sessionExpired) {
        // "meroshare:sessionExpired" event already fired in apiFetch.
        // logout() will be called by the event listener.
        // Don't proceed with loading stale data.
        setRefreshLoading(false);
        return;
      }
      console.warn("⚠️  Portfolio refresh failed:", refreshErr.message);
      // Non-session error — still load from DB cache
    } finally {
      setRefreshLoading(false);
    }

    loadStaticData(storedToken, freshPortfolio).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logout, loadStaticData]);

  // ── Individual data fetchers ──────────────────────────────────────────
  const fetchPortfolio       = useCallback(()       => getPortfolio(token),      [token]);
  const fetchSharesList      = useCallback(()       => getShares(token),         [token]);
  const fetchIssues          = useCallback((type)   => getIssues(token, type),   [token]);
  const fetchWacc            = useCallback((script) => getWacc(token, script),   [token]);
  const fetchSyncLogs        = useCallback(()       => getSyncLogs(token),       [token]);
  const doRefreshPortfolio   = useCallback(()       => refreshPortfolio(token),  [token]);

  const fetchJournalTrades    = useCallback(()         => getJournalTrades(token),             [token]);
  const createTrade           = useCallback((p)        => createJournalTrade(token, p),        [token]);
  const updateTrade           = useCallback((id, p)    => updateJournalTrade(token, id, p),    [token]);
  const deleteTrade           = useCallback((id)       => deleteJournalTrade(token, id),       [token]);

  const fetchInvestmentTrades = useCallback(()         => getInvestmentTrades(token),          [token]);
  const createInvestment      = useCallback((p)        => createInvestmentTrade(token, p),     [token]);
  const updateInvestment      = useCallback((id, p)    => updateInvestmentTrade(token, id, p), [token]);
  const deleteInvestment      = useCallback((id)       => deleteInvestmentTrade(token, id),    [token]);

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        loading,
        syncLoading,
        refreshLoading,
        error,
        isLoggedIn: !!token,
        portfolioData,
        fetchAllPortfolioData,
        login,
        logout,
        hydrateUser,
        fetchPortfolio,
        fetchSharesList,
        fetchIssues,
        fetchWacc,
        fetchSyncLogs,
        doRefreshPortfolio,
        fetchJournalTrades,
        createTrade,
        updateTrade,
        deleteTrade,
        fetchInvestmentTrades,
        createInvestment,
        updateInvestment,
        deleteInvestment,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
