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
import { createContext, useContext, useState, useCallback } from "react";
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
  const [loading,        setLoading]        = useState(false);   // login form spinner
  const [syncLoading,    setSyncLoading]    = useState(false);   // full-screen sync spinner
  const [refreshLoading, setRefreshLoading] = useState(false);   // portfolio refresh spinner
  const [error,          setError]          = useState(null);
  const [sessionExpired, setSessionExpired] = useState(false);   // MeroShare token expired

  // Cached portfolio-level data (shared across all tabs)
  const [portfolioData, setPortfolioData] = useState({
    portfolio:  null,   // { summary, items }
    shares:     [],
    wacc:       [],
    issues:     [],
    loaded:     false,
  });

  // ── Load all data from MongoDB ───────────────────────────────────────
  // portfolioOverride: pass in a fresh portfolio object to skip the
  // GET /portfolio call (used after a successful refresh sync).
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

  // Alias kept for backward compatibility
  const fetchAllPortfolioData = loadStaticData;

  // ── login ────────────────────────────────────────────────────────────
  // The backend blocks the JWT until any required sync finishes.
  // Frontend waits for the JWT, then loads everything from MongoDB.
  const login = useCallback(async ({ dpCode, username, password }) => {
    setLoading(true);
    setError(null);
    setSessionExpired(false);
    try {
      const data = await loginApi({ dpCode: String(dpCode), username, password });
      const tok  = data.token;

      sessionStorage.setItem(TOKEN_KEY, tok);
      setToken(tok);
      setUser(data.user);

      // syncedToday = true  → same-day skip (JWT returned instantly)
      // syncedToday = false → full sync just completed server-side
      if (!data.syncedToday) {
        setSyncLoading(true);
      }

      try {
        await loadStaticData(tok);
      } finally {
        setSyncLoading(false);
      }

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
    setPortfolioData({ portfolio: null, shares: [], wacc: [], issues: [], loaded: false });
  }, []);

  // ── hydrateUser: called on every page/browser refresh ───────────────
  //
  // Flow:
  //   1. Restore user identity from JWT (GET /auth/me).
  //   2. POST /portfolio/refresh → backend fetches live LTP from MeroShare
  //      using the stored session token (no password ever sent).
  //   3. Load shares, wacc, issues + the fresh portfolio from MongoDB.
  //   4. If MeroShare session expired → set sessionExpired so the UI can
  //      show a re-login prompt (app still loads cached DB data).
  //
  const hydrateUser = useCallback(async () => {
    if (!token || user) return;

    try {
      const me = await getMeApi(token);
      setUser(me);
    } catch {
      logout();
      return;
    }

    // ── Portfolio refresh (LTP / current values) ──────────────────────
    setRefreshLoading(true);
    let freshPortfolio = null;

    try {
      freshPortfolio = await refreshPortfolio(token);
      console.log("✅ Portfolio refresh complete (LTP updated).");
    } catch (refreshErr) {
      if (refreshErr.sessionExpired) {
        console.warn("⚠️  MeroShare session expired — prompting re-login.");
        setSessionExpired(true);
      } else {
        console.warn("⚠️  Portfolio refresh failed:", refreshErr.message);
      }
      // Fall through — load whatever is already in MongoDB
    } finally {
      setRefreshLoading(false);
    }

    // ── Load all data from MongoDB ────────────────────────────────────
    loadStaticData(token, freshPortfolio).catch(() => {});
  }, [token, user, logout, loadStaticData]);

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
        // Portfolio data cached from DB
        portfolioData,
        fetchAllPortfolioData,
        // Auth
        login,
        logout,
        hydrateUser,
        // Individual fetchers
        fetchProfile,
        fetchPortfolio,
        fetchSharesList,
        fetchIssues,
        fetchWacc,
        fetchSyncLogs,
        doSync,
        doRefreshPortfolio,
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