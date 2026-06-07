// src/App.jsx
//
// CHANGES FROM ORIGINAL:
//   • Reads `syncLoading` from AuthContext and shows a full-screen spinner
//     on first login while the backend sync + DB fetch completes.
//   • `trades` and `investments` start as [] and are populated ONLY from
//     the DB (via fetchJournalTrades / fetchInvestmentTrades).
//     No localStorage merging for trades or investments.
//   • Watchlist still uses localStorage (it's user-preference data, not
//     portfolio data).
//   • addTrade / addInv now set state from the DB response (not local uid()).
//   • Removed import of INIT_TRADES and INIT_INV (they're already []).
//
import { useState, useMemo, useEffect } from "react";
import "./styles/global.css";
import { INIT_WATCH } from "./data/initialData";
import { uid, loadFromStorage, saveToStorage } from "./utils/helpers";
import { useAuth } from "./context/AuthContext";
import { LoginPage } from "./pages/LoginPage";
import { Dashboard } from "./tabs/Dashboard";
import { Journal } from "./tabs/Journal";
import { Investment } from "./tabs/Investment";
import { Watchlist } from "./tabs/Watchlist";
import { Losing } from "./tabs/Losing";
import { MSPortfolio } from "./tabs/MSPortfolio";
import { MSIpos } from "./tabs/MSIpos";
import { MSWacc } from "./tabs/MSWacc";
import { TradeDetailModal } from "./components/TradeDetailModal";
import { TradeFormModal } from "./components/TradeFormModal";
import { InvDetailModal } from "./components/InvDetailModal";
import { InvestFormModal } from "./components/InvestFormModal";
import { WatchFormModal } from "./components/WatchFormModal";
import { NotificationBell } from "./components/NotificationBell";

const TABS = [
  { id: "dashboard",    label: "🏠 Dashboard" },
  { id: "journal",      label: "📝 Journal" },
  { id: "investment",   label: "💼 Investment" },
  { id: "watchlist",    label: "👁 Watchlist" },
  { id: "losing",       label: "📉 Losing" },
  { id: "ms-portfolio", label: "🏦 MS Portfolio", ms: true },
  { id: "ms-ipos",      label: "📋 Open IPOs",    ms: true },
  { id: "ms-wacc",      label: "⚖ WACC",          ms: true },
];

export default function App() {
  const {
    isLoggedIn, user, logout, hydrateUser, syncLoading,
    fetchJournalTrades, fetchInvestmentTrades,
    createTrade, updateTrade: updateJournal, deleteTrade: deleteJournal,
    createInvestment, updateInvestment: updateInvDB, deleteInvestment: deleteInvDB,
  } = useAuth();

  // Restore user object on page refresh
  useEffect(() => { hydrateUser(); }, [hydrateUser]);

  const [tab,          setTab]          = useState("dashboard");
  const [trades,       setTrades]       = useState([]);
  const [investments,  setInvestments]  = useState([]);
  const [dataLoaded,   setDataLoaded]   = useState(false);
  const [watchlist,    setWatchlist]    = useState(() => loadFromStorage("watchlist", INIT_WATCH));
  const [tradeDetail,  setTradeDetail]  = useState(null);
  const [tradeForm,    setTradeForm]    = useState(null);
  const [invDetail,    setInvDetail]    = useState(null);
  const [invForm,      setInvForm]      = useState(null);
  const [watchForm,    setWatchForm]    = useState(null);

  useMemo(() => { saveToStorage("watchlist", watchlist); }, [watchlist]);

  // ── Load trades & investments from DB whenever user logs in ──────────
  useEffect(() => {
    if (!isLoggedIn) {
      // Reset on logout
      setTrades([]);
      setInvestments([]);
      setDataLoaded(false);
      return;
    }

    let cancelled = false;

    Promise.all([
      fetchJournalTrades().catch(() => []),
      fetchInvestmentTrades().catch(() => []),
    ]).then(([journalRes, investRes]) => {
      if (cancelled) return;
      const journalArr  = Array.isArray(journalRes)  ? journalRes  : (journalRes?.data  || []);
      const investArr   = Array.isArray(investRes)   ? investRes   : (investRes?.data   || []);
      setTrades(journalArr);
      setInvestments(investArr);
      setDataLoaded(true);
    });

    return () => { cancelled = true; };
  }, [isLoggedIn, fetchJournalTrades, fetchInvestmentTrades]);

  // ── CRUD — Journal trades ─────────────────────────────────────────────
  const addTrade = async (d) => {
    try {
      const saved = await createTrade(d);
      setTrades(p => [...p, saved]);
    } catch (e) {
      console.warn("Failed to save journal trade", e);
    }
  };

  const updTrade = async (id, d) => {
    try {
      const updated = await updateJournal(id, d);
      setTrades(p => p.map(t => (t.id === id ? { ...t, ...updated } : t)));
    } catch (e) {
      console.warn("Failed to update journal trade", e);
    }
  };

  const delTrade = async (id) => {
    const item = trades.find(t => t.id === id);
    try {
      // Only delete manual entries from DB; imported ones are derived from WACC
      if (!item?.imported) await deleteJournal(id);
      setTrades(p => p.filter(t => t.id !== id));
    } catch (e) {
      console.warn("Failed to delete journal trade", e);
    }
  };

  // ── CRUD — Investments ────────────────────────────────────────────────
  const addInv = async (d) => {
    try {
      const saved = await createInvestment(d);
      setInvestments(p => [...p, saved]);
    } catch (e) {
      console.warn("Failed to save investment", e);
    }
  };

  const updInv = async (id, d) => {
    try {
      const updated = await updateInvDB(id, d);
      setInvestments(p => p.map(i => (i.id === id ? { ...i, ...updated } : i)));
    } catch (e) {
      console.warn("Failed to update investment", e);
    }
  };

  const delInv = async (id) => {
    const item = investments.find(i => i.id === id);
    try {
      if (!item?.imported) await deleteInvDB(id);
      setInvestments(p => p.filter(i => i.id !== id));
    } catch (e) {
      console.warn("Failed to delete investment", e);
    }
  };

  // ── Watchlist (localStorage only) ────────────────────────────────────
  const addWatch = d  => setWatchlist(p => [...p, { ...d, id: uid() }]);
  const updWatch = (id, d) => setWatchlist(p => p.map(w => w.id === id ? { ...w, ...d } : w));
  const delWatch = id => setWatchlist(p => p.filter(w => w.id !== id));

  const handleTabClick = id => setTab(id);
  const handleFAB = () => {
    if (tab === "journal" || tab === "losing") setTradeForm({ mode: "add", data: {} });
    else if (tab === "investment") setInvForm({ mode: "add", data: {} });
    else if (tab === "watchlist") setWatchForm({ mode: "add", data: {} });
  };

  const isMsTab  = tab.startsWith("ms-");
  const showFAB  = !isMsTab && tab !== "dashboard" && tab !== "losing";

  // ── Not logged in ──────────────────────────────────────────────────────
  if (!isLoggedIn) return <LoginPage />;

  // ── First-login full-screen sync spinner ──────────────────────────────
  if (syncLoading) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", height: "100vh", gap: 16,
        background: "var(--bg, #0f1117)", color: "var(--text, #e2e8f0)",
      }}>
        <div style={{ fontSize: 40 }}>📊</div>
        <h2 style={{ margin: 0, fontSize: 22 }}>Setting up your portfolio…</h2>
        <p style={{ margin: 0, opacity: 0.6, textAlign: "center", maxWidth: 340 }}>
          Fetching your MeroShare data for the first time and saving it to the database.
          This only happens once.
        </p>
        <div className="spinner" style={{
          width: 36, height: 36, border: "4px solid rgba(255,255,255,0.15)",
          borderTopColor: "#6366f1", borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Per-tab data loading skeleton ─────────────────────────────────────
  if (!dataLoaded) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", color: "var(--text, #e2e8f0)",
      }}>
        Loading your data…
      </div>
    );
  }

  // ── Main UI ────────────────────────────────────────────────────────────
  return (
    <>
      <header className="topbar">
        <div className="topbar__logo">
          <div className="topbar__icon">📊</div>
          <div>
            <div className="topbar__title">Kitakat</div>
            <div className="topbar__subtitle">Investment Journal &amp; MeroShare Tracker</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {isLoggedIn && (
            <div className="topbar__user-group">
              <button className="topbar__logout-btn" onClick={logout} title="Log out">
                Logout
              </button>
              <div className="topbar__profile-block">
                <div className="topbar__profile-name">
                  {user?.name || user?.username || "MeroShare"}
                </div>
                {user?.email && (
                  <a className="topbar__profile-email" href={`mailto:${user.email}`}>
                    {user.email}
                  </a>
                )}
              </div>
            </div>
          )}
          <div className="topbar__date">
            {new Date().toLocaleDateString("en-US", {
              weekday: "short", year: "numeric", month: "short", day: "numeric",
            })}
          </div>
          <NotificationBell />
        </div>
      </header>

      <nav className="tabbar">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab-btn${tab === t.id ? " tab-btn--active" : ""}`}
            onClick={() => handleTabClick(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="page">
        {tab === "dashboard"    && <Dashboard    trades={trades}      investments={investments} />}
        {tab === "journal"      && <Journal      trades={trades}      onScripClick={setTradeDetail} />}
        {tab === "investment"   && <Investment   investments={investments} onScripClick={setInvDetail} />}
        {tab === "watchlist"    && <Watchlist    watchlist={watchlist} onEdit={w => setWatchForm({ mode: "edit", data: w })} onDelete={delWatch} />}
        {tab === "losing"       && <Losing       trades={trades}      onScripClick={setTradeDetail} />}
        {tab === "ms-portfolio" && <MSPortfolio />}
        {tab === "ms-ipos"      && <MSIpos />}
        {tab === "ms-wacc"      && <MSWacc />}
      </main>

      {showFAB && (
        <button className="fab" onClick={handleFAB}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>+</span>
          {tab === "investment" ? "Add Investment" : tab === "watchlist" ? "Add to Watchlist" : "Log Trade"}
        </button>
      )}

      {tradeDetail && (
        <TradeDetailModal
          trade={tradeDetail}
          onEdit={t => { setTradeDetail(null); setTradeForm({ mode: "edit", data: t }); }}
          onDelete={id => { delTrade(id); setTradeDetail(null); }}
          onClose={() => setTradeDetail(null)}
        />
      )}
      {tradeForm && (
        <TradeFormModal
          mode={tradeForm.mode}
          init={tradeForm.data}
          onSave={d => { tradeForm.mode === "add" ? addTrade(d) : updTrade(tradeForm.data.id, d); setTradeForm(null); }}
          onClose={() => setTradeForm(null)}
        />
      )}
      {invDetail && (
        <InvDetailModal
          inv={invDetail}
          onEdit={i => { setInvDetail(null); setInvForm({ mode: "edit", data: i }); }}
          onDelete={id => { delInv(id); setInvDetail(null); }}
          onClose={() => setInvDetail(null)}
        />
      )}
      {invForm && (
        <InvestFormModal
          mode={invForm.mode}
          init={invForm.data}
          onSave={d => { invForm.mode === "add" ? addInv(d) : updInv(invForm.data.id, d); setInvForm(null); }}
          onClose={() => setInvForm(null)}
        />
      )}
      {watchForm && (
        <WatchFormModal
          mode={watchForm.mode}
          init={watchForm.data}
          onSave={d => { watchForm.mode === "add" ? addWatch(d) : updWatch(watchForm.data.id, d); setWatchForm(null); }}
          onClose={() => setWatchForm(null)}
        />
      )}
    </>
  );
}