// src/context/AuthContext.jsx
//
// SYNC BEHAVIOR IMPLEMENTED:
//
// ┌─ LOGIN ────────────────────────────────────────────────────────────┐
// │  Backend decides whether to run full sync (different day) or skip  │
// │  (same day).  Frontend simply waits for the JWT, then loads all   │
// │  data from MongoDB.  `syncedToday` from the response tells the UI │
// │  whether a full sync ran.                                          │
// └────────────────────────────────────────────────────────────────────┘
//
// ┌─ BROWSER REFRESH (hydrateUser) ────────────────────────────────────┐
// │  1. Restore user from JWT (GET /auth/me).                          │
// │  2. Call POST /portfolio/refresh — fetches ONLY portfolio + LTP.   │
// │  3. Load all other data (shares, wacc, issues) from MongoDB.       │
// │  4. If the MeroShare session is expired, set sessionExpired flag    │
// │     so the UI can prompt re-login.                                 │
// └────────────────────────────────────────────────────────────────────┘
//
// FIX (duplicate API calls):
//   hydrateUser previously had `user` in its useCallback deps. When it called
//   setUser(me) mid-run, `user` changed, giving hydrateUser a new reference,
//   which caused App.jsx's useEffect([hydrateUser]) to re-fire and run the
//   entire hydration a second time (double /auth/me, double /portfolio/refresh,
//   double /shares, /wacc, /issues, /journal-trades, /investment-trades).
//
//   Fix: use a `useRef` flag (hydratedRef) that is set to true on the first
//   call. hydrateUser bails out immediately if already run. The dep array now
//   omits `user` (accessed via ref) so the useCallback reference is stable
//   across the user state change.
//
import { createContext, useContext, useState, useCallback, useRef } from "react";
import { loginApi, getMeApi } from "../api/auth";
import {
  getProfile, getPortfolio, getShares, getIssues, getWacc,
  refreshPortfolio,
  triggerSync, getSyncLogs,
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
  const [sessionExpired, setSessionExpired] = useState(false);

  // Guard: prevents hydrateUser from running more than once per session.
  // Without this, setting `user` state inside hydrateUser caused the
  // useCallback to get a new reference (user changed), which re-triggered
  // App.jsx's useEffect([hydrateUser]) and doubled every API call.
  const hydratedRef = useRef(false);

  // Cached portfolio-level data (shared across all tabs)
  const [portfolioData, setPortfolioData] = useState({
    portfolio:  null,
    shares:     [],
    wacc:       [],
    issues:     [],
    loaded:     false,
  });

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
  const login = useCallback(async ({ dpCode, username, password }) => {
    setLoading(true);
    setError(null);
    setSessionExpired(false);
    // Reset hydration guard so hydrateUser can run on next page refresh
    hydratedRef.current = false;
    try {
      const data = await loginApi({ dpCode: String(dpCode), username, password });
      const tok  = data.token;

      sessionStorage.setItem(TOKEN_KEY, tok);
      setToken(tok);
      setUser(data.user);

      if (!data.syncedToday) {
        setSyncLoading(true);
      }

      try {
        await loadStaticData(tok);
      } finally {
        setSyncLoading(false);
      }

      // Mark as hydrated so a subsequent page refresh still works correctly
      hydratedRef.current = true;
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [loadStaticData]);

  // ── logout ───────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setError(null);
    setSessionExpired(false);
    hydratedRef.current = false;
    setPortfolioData({ portfolio: null, shares: [], wacc: [], issues: [], loaded: false });
  }, []);

  // ── hydrateUser: called on every page/browser refresh ───────────────
  //
  // IMPORTANT: This function must only run ONCE per page load.
  // The hydratedRef guard ensures that even if the useCallback reference
  // changes (due to token changing), the actual fetch logic never fires twice.
  //
  // Dep array intentionally omits `user` — we check hydratedRef instead.
  // This keeps the useCallback reference stable after setUser() fires, which
  // prevents App.jsx's useEffect([hydrateUser]) from re-triggering.
  //
  const hydrateUser = useCallback(async () => {
    // Bail out if already hydrated OR no token in storage
    const storedToken = sessionStorage.getItem(TOKEN_KEY);
    if (!storedToken) return;
    if (hydratedRef.current) return;

    // Mark immediately to prevent any concurrent invocation from also running
    hydratedRef.current = true;

    try {
      const me = await getMeApi(storedToken);
      setUser(me);
    } catch {
      logout();
      return;
    }

    // ── Portfolio refresh (LTP / current values) ──────────────────────
    setRefreshLoading(true);
    let freshPortfolio = null;

    try {
      freshPortfolio = await refreshPortfolio(storedToken);
      console.log("✅ Portfolio refresh complete (LTP updated).");
    } catch (refreshErr) {
      if (refreshErr.sessionExpired) {
        console.warn("⚠️  MeroShare session expired — loading from DB cache.");
        setSessionExpired(true);
      } else {
        console.warn("⚠️  Portfolio refresh failed:", refreshErr.message);
      }
      // Fall through — load whatever is already in MongoDB
    } finally {
      setRefreshLoading(false);
    }

    // ── Load all data from MongoDB ────────────────────────────────────
    loadStaticData(storedToken, freshPortfolio).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logout, loadStaticData]);
  // NOTE: `token` and `user` are intentionally NOT in this dep array.
  // `token` is read from sessionStorage directly (always fresh).
  // `user` would cause a re-run after setUser() fires — exactly the bug we fixed.

  // ── Individual data fetchers ──────────────────────────────────────────
  const fetchProfile         = useCallback(()       => getProfile(token),        [token]);
  const fetchPortfolio       = useCallback(()       => getPortfolio(token),      [token]);
  const fetchSharesList      = useCallback(()       => getShares(token),         [token]);
  const fetchIssues          = useCallback((type)   => getIssues(token, type),   [token]);
  const fetchWacc            = useCallback((script) => getWacc(token, script),   [token]);
  const fetchSyncLogs        = useCallback(()       => getSyncLogs(token),       [token]);
  const doSync               = useCallback(()       => triggerSync(token),       [token]);
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
        sessionExpired,
        error,
        isLoggedIn: !!token,
        portfolioData,
        fetchAllPortfolioData,
        login,
        logout,
        hydrateUser,
        fetchProfile,
        fetchPortfolio,
        fetchSharesList,
        fetchIssues,
        fetchWacc,
        fetchSyncLogs,
        doSync,
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