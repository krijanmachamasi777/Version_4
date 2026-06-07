// REPLACE the existing imports with:
import { useState, useMemo } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell,
} from "recharts";
import { fmt, isClosedTrade, tradePL } from "../utils/helpers";
import "../styles/dashboard.css";
// ── Sector pie colour palette ──────────────────────────────
const SECTOR_COLORS = [
  "#0a84ff", "#34c759", "#ff9f0a", "#bf5af2",
  "#ff453a", "#5ac8fa", "#ffd60a", "#30d158",
  "#ff6b6b", "#a78bfa", "#06b6d4",
];

// Custom label rendered inside each pie slice
const renderPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
  if (percent < 0.05) return null; // skip tiny slices
  const RADIAN = Math.PI / 180;
  const r = innerRadius + (outerRadius - innerRadius) * 0.55;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central"
      fontSize={11} fontWeight={700}>
      {(percent * 100).toFixed(0)}%
    </text>
  );
};
// ── JOURNAL DASHBOARD ──────────────────────────────────────
function JournalDashboard({ trades }) {
  const total        = trades.reduce((s, t) => s + t.buyAmt, 0);
  const closedTrades = trades.filter(isClosedTrade);
  const netPL        = closedTrades.reduce((s, t) => s + tradePL(t), 0);
  const totalQty     = trades.reduce((s, t) => s + t.qty, 0);
  const wins         = closedTrades.filter(t => tradePL(t) > 0).length;
  const winRate      = closedTrades.length
    ? ((wins / closedTrades.length) * 100).toFixed(2) : "0.00";

  const plS =
    netPL > 500  ? { e: "🚀", l: "Crushing It!", c: "v--profit" } :
    netPL > 0    ? { e: "😊", l: "In Profit",    c: "v--profit" } :
    netPL === 0  ? { e: "😐", l: "Break Even",   c: ""          } :
    netPL > -400 ? { e: "😟", l: "Minor Loss",   c: "v--loss"   } :
                   { e: "😰", l: "Heavy Loss",   c: "v--loss"   };

  // Monthly P&L — line chart data
  const lineData = useMemo(() => {
    const m = {};
    trades.forEach(t => {
      if (!isClosedTrade(t) || !t.soldDate) return;
      const k   = t.soldDate.slice(0, 7);
      const lbl = new Date(t.soldDate + "T12:00:00")
        .toLocaleDateString("en", { month: "short", year: "2-digit" });
      if (!m[k]) m[k] = { name: lbl, Profit: 0, Loss: 0 };
      const pl = tradePL(t);
      if (pl > 0) m[k].Profit += pl; else m[k].Loss += Math.abs(pl);
    });
    return Object.entries(m)
      .sort((a, b) => a[0] < b[0] ? -1 : 1)
      .map(([, v]) => ({
        name:   v.name,
        Profit: Number(v.Profit.toFixed(2)),
        Loss:   Number(v.Loss.toFixed(2)),
      }));
  }, [trades]);

  // Monthly capital vs profit — bar chart data
  const capitalBarData = useMemo(() => {
    const m = {};
    trades.forEach(t => {
      if (!isClosedTrade(t) || !t.soldDate) return;
      const k   = t.soldDate.slice(0, 7);
      const lbl = new Date(t.soldDate + "T12:00:00")
        .toLocaleDateString("en", { month: "short", year: "2-digit" });
      if (!m[k]) m[k] = { name: lbl, Invested: 0, NetProfit: 0 };
      m[k].Invested  += t.buyAmt;
      m[k].NetProfit += tradePL(t);
    });
    return Object.entries(m)
      .sort((a, b) => a[0] < b[0] ? -1 : 1)
      .map(([, v]) => ({
        name:      v.name,
        Invested:  Number(v.Invested.toFixed(2)),
        NetProfit: Number(v.NetProfit.toFixed(2)),
      }));
  }, [trades]);

  // Top 3 winning trades
  const top3Wins = useMemo(() => (
    closedTrades
      .filter(t => tradePL(t) > 0)
      .sort((a, b) => tradePL(b) - tradePL(a))
      .slice(0, 3)
      .map(t => ({ name: t.scrip, NetPL: Number(tradePL(t).toFixed(2)) }))
  ), [closedTrades]);

  // Top 3 losing trades
  const top3Losses = useMemo(() => (
    closedTrades
      .filter(t => tradePL(t) < 0)
      .sort((a, b) => tradePL(a) - tradePL(b))
      .slice(0, 3)
      .map(t => ({ name: t.scrip, NetPL: Number(tradePL(t).toFixed(2)) }))
  ), [closedTrades]);

  const tooltipStyle = { background: "var(--s2)", border: "1px solid var(--glow)", borderRadius: 8, fontSize: 12 };

  return (
    <div className="dashboard">
      {/* ── Stat cards ── */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-card__label">Total Invested</div>
          <div className="stat-card__value v--blue">₹{fmt(total)}</div>
          <div className="stat-card__sub">Across all trades</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">Net P&amp;L</div>
          <div className={`stat-card__value ${netPL >= 0 ? "v--profit" : "v--loss"}`}>
            {netPL >= 0 ? "+" : "-"}₹{fmt(Math.abs(netPL))}
          </div>
          <div className="stat-card__sub">Realized gains/losses</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">Win Rate</div>
          <div className="stat-card__value v--purple">{winRate}%</div>
          <div className="stat-card__sub">{wins} of {trades.length} trades</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">Total Qty Traded</div>
          <div className="stat-card__value">{totalQty.toLocaleString()}</div>
          <div className="stat-card__sub">Shares / units</div>
        </div>
        <div className="emoji-card">
          <div className="emoji-card__icon">{plS.e}</div>
          <div className={`emoji-card__label ${plS.c}`}>{plS.l}</div>
          <div className="emoji-card__sub">Current P&amp;L Scenario</div>
        </div>
      </div>

      {/* ── Line chart: P&L monthly ── */}
      <div className="chart-box">
        <div className="chart-box__title">Profit vs Loss — Monthly</div>
        <div className="chart-box__sub">Green line = gains · Red line = losses per month</div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={lineData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--b)" />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} tickFormatter={v => fmt(v)} />
            <Tooltip formatter={v => fmt(v)} contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
            <Line type="monotone" dataKey="Profit" stroke="var(--g)" strokeWidth={2.5} dot={{ r: 5, fill: "var(--g)" }} activeDot={{ r: 7 }} />
            <Line type="monotone" dataKey="Loss"   stroke="var(--r)" strokeWidth={2.5} dot={{ r: 5, fill: "var(--r)" }} activeDot={{ r: 7 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* ── Bar chart: capital vs profit ── */}
      <div className="chart-box">
        <div className="chart-box__title">Total Invested Capital vs Net Profit</div>
        <div className="chart-box__sub">Capital deployed each month vs returns generated</div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={capitalBarData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--b)" />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} tickFormatter={v => fmt(v)} />
            <Tooltip formatter={v => fmt(v)} contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
            <Bar dataKey="Invested" fill="var(--adim)" stroke="var(--acc)" strokeWidth={1} radius={[5,5,0,0]} name="Total Invested" />
            <Bar dataKey="NetProfit" radius={[5,5,0,0]} name="Net Profit">
              {capitalBarData.map((d, i) => (
                <Cell key={i} fill={d.NetProfit >= 0 ? "var(--g)" : "var(--r)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Top 3 wins and losses side by side ── */}
      <div className="chart-row">
        <div className="chart-box">
          <div className="chart-box__title">🏆 Top 3 Winning Trades</div>
          <div className="chart-box__sub">Highest net P&amp;L from closed trades</div>
          {top3Wins.length === 0 ? (
            <div className="chart-empty">No winning trades recorded yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={top3Wins} layout="vertical" margin={{ top: 5, right: 20, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--b)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} tickFormatter={v => fmt(v)} />
                <YAxis type="category" dataKey="name" width={72} tick={{ fontSize: 12, fill: "var(--fg)", fontWeight: 700 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={v => [`₹${fmt(v)}`, "Net P&L"]} contentStyle={tooltipStyle} />
                <Bar dataKey="NetPL" fill="var(--g)" radius={[0,5,5,0]} name="Net P&L" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="chart-box">
          <div className="chart-box__title">📉 Top 3 Losing Trades</div>
          <div className="chart-box__sub">Largest losses from closed trades</div>
          {top3Losses.length === 0 ? (
            <div className="chart-empty">No losing trades recorded yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={top3Losses} layout="vertical" margin={{ top: 5, right: 20, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--b)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} tickFormatter={v => fmt(v)} />
                <YAxis type="category" dataKey="name" width={72} tick={{ fontSize: 12, fill: "var(--fg)", fontWeight: 700 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={v => [`₹${fmt(v)}`, "Net P&L"]} contentStyle={tooltipStyle} />
                <Bar dataKey="NetPL" fill="var(--r)" radius={[0,5,5,0]} name="Net P&L" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

// ── INVESTMENT DASHBOARD ────────────────────────────────────
function InvestmentDashboard({ investments }) {
  const totalScrips = useMemo(() => {
    const s = new Set(investments.map(i => (i.scrip || "").trim().toUpperCase()));
    return s.size;
  }, [investments]);

  const totalInvestment = investments.reduce((s, i) => s + Number(i.buyAmt || 0), 0);

  const totalNetPL = useMemo(() => (
    investments
      .filter(i => !!i.soldDate && Number(i.soldAmt) > 0)
      .reduce((s, i) => s + (Number(i.soldAmt) - Number(i.buyAmt)), 0)
  ), [investments]);

  const holdingCount = investments.filter(i => !i.soldDate).length;
  const soldCount    = investments.filter(i =>  !!i.soldDate).length;

  // Sector pie data (qty-based)
  const sectorPieData = useMemo(() => {
    const m = {};
    investments.forEach(inv => {
      const sec = inv.sector?.trim() || "Other";
      m[sec] = (m[sec] || 0) + (Number(inv.qty) || 0);
    });
    return Object.entries(m)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [investments]);

  // Sector-wise net P&L (sold only)
  const sectorPLData = useMemo(() => {
    const m = {};
    investments.forEach(inv => {
      if (!inv.soldDate || !Number(inv.soldAmt)) return;
      const sec = inv.sector?.trim() || "Other";
      m[sec] = (m[sec] || 0) + (Number(inv.soldAmt) - Number(inv.buyAmt));
    });
    return Object.entries(m)
      .map(([name, NetPL]) => ({ name, NetPL: Number(NetPL.toFixed(2)) }))
      .sort((a, b) => b.NetPL - a.NetPL);
  }, [investments]);

  // Sold scrip net P&L
  const soldScripPLData = useMemo(() => {
    const m = {};
    investments.forEach(inv => {
      if (!inv.soldDate || !Number(inv.soldAmt)) return;
      const key = (inv.scrip || "").trim().toUpperCase();
      if (!m[key]) m[key] = { name: inv.scrip, NetPL: 0 };
      m[key].NetPL += Number(inv.soldAmt) - Number(inv.buyAmt);
    });
    return Object.values(m)
      .map(d => ({ ...d, NetPL: Number(d.NetPL.toFixed(2)) }))
      .sort((a, b) => b.NetPL - a.NetPL);
  }, [investments]);

  const tooltipStyle = { background: "var(--s2)", border: "1px solid var(--glow)", borderRadius: 8, fontSize: 12 };
  const sectorChartH = Math.max(180, sectorPLData.length    * 52);
  const soldChartH   = Math.max(180, soldScripPLData.length * 52);

  return (
    <div className="dashboard">
      {/* ── Info stat cards ── */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-card__label">Total Scrips</div>
          <div className="stat-card__value v--purple">{totalScrips}</div>
          <div className="stat-card__sub">Unique scrips invested</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">Total Investment</div>
          <div className="stat-card__value v--blue">₹{fmt(totalInvestment)}</div>
          <div className="stat-card__sub">Total capital deployed</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">Total Net P&amp;L</div>
          <div className={`stat-card__value ${totalNetPL >= 0 ? "v--profit" : "v--loss"}`}>
            {totalNetPL >= 0 ? "+" : "-"}₹{fmt(Math.abs(totalNetPL))}
          </div>
          <div className="stat-card__sub">From sold investments</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">Holding</div>
          <div className="stat-card__value">{holdingCount}</div>
          <div className="stat-card__sub">Active positions</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">Sold</div>
          <div className="stat-card__value v--blue">{soldCount}</div>
          <div className="stat-card__sub">Exited positions</div>
        </div>
      </div>

      {/* ── Sector pie chart ── */}
      <div className="chart-box">
        <div className="chart-box__title">Portfolio by Sector</div>
        <div className="chart-box__sub">Sector allocation by total quantity held in investments</div>
        {sectorPieData.length === 0 ? (
          <div className="chart-empty">No investment data yet — add investments to see sector breakdown.</div>
        ) : (
          <div className="pie-row">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={sectorPieData} dataKey="value" nameKey="name"
                  cx="50%" cy="50%" outerRadius={110} innerRadius={0}
                  paddingAngle={2} labelLine={false} label={renderPieLabel}>
                  {sectorPieData.map((_, i) => (
                    <Cell key={i} fill={SECTOR_COLORS[i % SECTOR_COLORS.length]}
                      stroke="var(--bg)" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip formatter={(v, name) => [`${v.toLocaleString()} units`, name]}
                  contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pie-legend">
              {sectorPieData.map((d, i) => {
                const tot = sectorPieData.reduce((s, x) => s + x.value, 0);
                const pct = tot ? ((d.value / tot) * 100).toFixed(1) : 0;
                return (
                  <div key={d.name} className="pie-legend__item">
                    <span className="pie-legend__dot"
                      style={{ background: SECTOR_COLORS[i % SECTOR_COLORS.length] }} />
                    <span className="pie-legend__name">{d.name}</span>
                    <span className="pie-legend__val">
                      {d.value.toLocaleString()}
                      <span className="pie-legend__pct"> ({pct}%)</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Sector-wise Net P&L ── */}
      <div className="chart-box">
        <div className="chart-box__title">Sector-wise Net P&amp;L</div>
        <div className="chart-box__sub">Net profit / loss realized per sector from sold investments</div>
        {sectorPLData.length === 0 ? (
          <div className="chart-empty">No sold investments to display sector P&amp;L.</div>
        ) : (
          <ResponsiveContainer width="100%" height={sectorChartH}>
            <BarChart data={sectorPLData} layout="vertical"
              margin={{ top: 5, right: 20, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--b)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: "var(--muted)" }}
                axisLine={false} tickLine={false} tickFormatter={v => fmt(v)} />
              <YAxis type="category" dataKey="name" width={110}
                tick={{ fontSize: 12, fill: "var(--fg)", fontWeight: 700 }}
                axisLine={false} tickLine={false} />
              <Tooltip formatter={v => [`₹${fmt(v)}`, "Net P&L"]} contentStyle={tooltipStyle} />
              <Bar dataKey="NetPL" radius={[0,5,5,0]} name="Net P&L">
                {sectorPLData.map((d, i) => (
                  <Cell key={i} fill={d.NetPL >= 0 ? "var(--g)" : "var(--r)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Sold scrip Net P&L ── */}
      <div className="chart-box">
        <div className="chart-box__title">Sold Scrip Net P&amp;L</div>
        <div className="chart-box__sub">Net profit / loss per scrip from all exited investment positions</div>
        {soldScripPLData.length === 0 ? (
          <div className="chart-empty">No sold investments yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height={soldChartH}>
            <BarChart data={soldScripPLData} layout="vertical"
              margin={{ top: 5, right: 20, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--b)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: "var(--muted)" }}
                axisLine={false} tickLine={false} tickFormatter={v => fmt(v)} />
              <YAxis type="category" dataKey="name" width={90}
                tick={{ fontSize: 12, fill: "var(--fg)", fontWeight: 700 }}
                axisLine={false} tickLine={false} />
              <Tooltip formatter={v => [`₹${fmt(v)}`, "Net P&L"]} contentStyle={tooltipStyle} />
              <Bar dataKey="NetPL" radius={[0,5,5,0]} name="Net P&L">
                {soldScripPLData.map((d, i) => (
                  <Cell key={i} fill={d.NetPL >= 0 ? "var(--g)" : "var(--r)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// ── MAIN DASHBOARD with switcher ───────────────────────────
export function Dashboard({ trades, investments = [] }) {
  const [mode, setMode] = useState("journal");

  return (
    <>
      <div className="dash-switcher">
        <button
          className={`dash-switch-btn${mode === "journal" ? " dash-switch-btn--active" : ""}`}
          onClick={() => setMode("journal")}
        >
          📝 Journal Dashboard
        </button>
        <button
          className={`dash-switch-btn${mode === "investment" ? " dash-switch-btn--active" : ""}`}
          onClick={() => setMode("investment")}
        >
          💼 Investment Dashboard
        </button>
      </div>

      {mode === "journal"    && <JournalDashboard    trades={trades} />}
      {mode === "investment" && <InvestmentDashboard investments={investments} />}
    </>
  );
}