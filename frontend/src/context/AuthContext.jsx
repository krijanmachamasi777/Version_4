// src/context/AuthContext.jsx
//
// CHANGES FROM ORIGINAL:
//   • Added `syncLoading` state — true while the first-login blocking sync runs.
//   • login() now reads `firstLogin` from the backend response and exposes it.
//   • Added `portfolioData` state to hold DB-fetched portfolio/shares/wacc/issues
//     so tabs can read from context rather than calling the API themselves.
//   • fetchAllPortfolioData() fetches all 4 collections in parallel after login.
//   • hydrateUser() also calls fetchAllPortfolioData() after restoring from token.
//
import { createContext, useContext, useState, useCallback } from "react";
import { loginApi, getMeApi } from "../api/auth";
import {
  getProfile, getPortfolio, getShares, getIssues, getWacc,
  triggerSync, getSyncLogs,
  getJournalTrades, createJournalTrade, updateJournalTrade, deleteJournalTrade,
  getInvestmentTrades, createInvestmentTrade, updateInvestmentTrade, deleteInvestmentTrade,
} from "../api/meroshare";

const AuthContext = createContext(null);
const TOKEN_KEY   = "kitakat_token";

export function AuthProvider({ children }) {
  const [token, setToken]             = useState(() => sessionStorage.getItem(TOKEN_KEY) || null);
  const [user,  setUser]              = useState(null);
  const [loading,     setLoading]     = useState(false);   // login form spinner
  const [syncLoading, setSyncLoading] = useState(false);   // first-login full-screen spinner
  const [error,       setError]       = useState(null);

  // Cached portfolio-level data (shared across all tabs)
  const [portfolioData, setPortfolioData] = useState({
    portfolio:  null,   // { summary, items }
    shares:     [],
    wacc:       [],
    issues:     [],
    loaded:     false,
  });

  // ── Fetch all portfolio data from DB ────────────────────────────────
  const fetchAllPortfolioData = useCallback(async (tok) => {
    const t = tok || token;
    if (!t) return;
    try {
      const [portfolio, shares, wacc, issues] = await Promise.all([
        getPortfolio(t),
        getShares(t),
        getWacc(t),
        getIssues(t),
      ]);
      setPortfolioData({
        portfolio: portfolio || null,
        shares:    Array.isArray(shares) ? shares : (shares?.data || []),
        wacc:      Array.isArray(wacc)   ? wacc   : (wacc?.data   || []),
        issues:    Array.isArray(issues) ? issues : (issues?.data  || []),
        loaded: true,
      });
    } catch (e) {
      console.warn("fetchAllPortfolioData failed:", e.message);
      setPortfolioData(prev => ({ ...prev, loaded: true }));
    }
  }, [token]);

  // ── login ────────────────────────────────────────────────────────────
  const login = useCallback(async ({ dpCode, username, password }) => {
    setLoading(true);
    setError(null);
    try {
      const data = await loginApi({ dpCode: String(dpCode), username, password });
      const tok  = data.token;

      sessionStorage.setItem(TOKEN_KEY, tok);
      setToken(tok);
      setUser(data.user);

      // If this was a first login the backend already completed the sync
      // (blocking), so we can show the "syncing…" spinner briefly, then
      // fetch from DB immediately.
      if (data.firstLogin) {
        setSyncLoading(true);
        try {
          await fetchAllPortfolioData(tok);
        } finally {
          setSyncLoading(false);
        }
      } else {
        // Returning login — fetch DB data in background; backend sync also
        // runs in background.
        fetchAllPortfolioData(tok).catch(() => {});
      }

      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [fetchAllPortfolioData]);

  // ── logout ───────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setError(null);
    setPortfolioData({ portfolio: null, shares: [], wacc: [], issues: [], loaded: false });
  }, []);

  // ── hydrateUser: restore user after page refresh ─────────────────────
  const hydrateUser = useCallback(async () => {
    if (token && !user) {
      try {
        const me = await getMeApi(token);
        setUser(me);
        // Restore portfolio cache after refresh
        fetchAllPortfolioData(token).catch(() => {});
      } catch {
        logout();
      }
    }
  }, [token, user, logout, fetchAllPortfolioData]);

  // ── Data fetchers ─────────────────────────────────────────────────────
  const fetchProfile         = useCallback(()          => getProfile(token),        [token]);
  const fetchPortfolio       = useCallback(()          => getPortfolio(token),      [token]);
  const fetchSharesList      = useCallback(()          => getShares(token),         [token]);
  const fetchIssues          = useCallback((type)      => getIssues(token, type),   [token]);
  const fetchWacc            = useCallback((script)    => getWacc(token, script),   [token]);
  const fetchSyncLogs        = useCallback(()          => getSyncLogs(token),       [token]);
  const doSync               = useCallback(()          => triggerSync(token),       [token]);

  const fetchJournalTrades   = useCallback(()          => getJournalTrades(token),              [token]);
  const createTrade          = useCallback((p)         => createJournalTrade(token, p),         [token]);
  const updateTrade          = useCallback((id, p)     => updateJournalTrade(token, id, p),     [token]);
  const deleteTrade          = useCallback((id)        => deleteJournalTrade(token, id),        [token]);

  const fetchInvestmentTrades = useCallback(()         => getInvestmentTrades(token),           [token]);
  const createInvestment      = useCallback((p)        => createInvestmentTrade(token, p),      [token]);
  const updateInvestment      = useCallback((id, p)    => updateInvestmentTrade(token, id, p),  [token]);
  const deleteInvestment      = useCallback((id)       => deleteInvestmentTrade(token, id),     [token]);

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        loading,
        syncLoading,
        error,
        isLoggedIn: !!token,
        // Portfolio data cached from DB
        portfolioData,
        fetchAllPortfolioData,
        // Auth
        login,
        logout,
        hydrateUser,
        // Individual fetchers (used by MS tabs that need live data)
        fetchProfile,
        fetchPortfolio,
        fetchSharesList,
        fetchIssues,
        fetchWacc,
        fetchSyncLogs,
        doSync,
        // Journal
        fetchJournalTrades,
        createTrade,
        updateTrade,
        deleteTrade,
        // Investment
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