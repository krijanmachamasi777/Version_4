// ── CONSTANTS ─────────────────────────────────────────────
export const RR_OPTS = ["—", ...Array.from({ length: 50 }, (_, i) => `1:${i + 1}`)];

export const SECTORS = [
  "Banking", "Dev Bank", "Finance", "Hotels", "Hydro",
  "Manufacturing", "Microfinance", "Life Insurance",
  "Non Life Insurance", "Mutual Fund", "Other",
];

// ── HELPERS ───────────────────────────────────────────────
export const uid      = () => Math.random().toString(36).slice(2, 9);
export const todayStr = () => new Date().toISOString().slice(0, 10);
export const diffDays = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
export const holdDays = (a, b) => (a && (b || true)) ? diffDays(a, b || todayStr()) : "—";
export const formatHoldingDuration = (a, b) => {
  if (!a) return "—";
  const start = new Date(a);
  const end = b ? new Date(b) : new Date();
  const totalDays = Math.max(0, Math.round((end - start) / 86400000));
  if (!Number.isFinite(totalDays) || totalDays <= 0) return "—";

  const years = Math.floor(totalDays / 365);
  const months = Math.floor((totalDays % 365) / 30);
  const days = totalDays - (years * 365) - (months * 30);

  return [years ? `${years} yr` : null, months ? `${months} mo` : null, days ? `${days} d` : null]
    .filter(Boolean)
    .join(" ");
};
export const fmt      = n => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
export const isClosedTrade = trade => Boolean(trade && (trade.soldDate || Number(trade.soldAmt) > 0 || Number(trade.sellRate) > 0));
export const tradePL       = trade => isClosedTrade(trade) ? Number(trade.soldAmt || 0) - Number(trade.buyAmt || 0) : null;
export const pctRet       = (pl, amt) => amt ? ((pl / amt) * 100).toFixed(2) + "%" : "—";

export const nextTSN = trades => {
  const nums = trades.map(t => {
    const tsn = typeof t?.tsn === "string" ? t.tsn.replace("TSN", "") : "";
    const n = Number(tsn);
    return Number.isFinite(n) ? n : 0;
  });
  return `TSN${String(Math.max(0, ...nums) + 1).padStart(3, "0")}`;
};

export const findRecentTSN = (entries, scrip, boughtDate, maxDays = 12) => {
  if (!scrip || !boughtDate) return null;
  const target = new Date(boughtDate);
  const normalized = scrip.trim().toUpperCase();
  const candidate = entries
    .filter(e => e?.scrip?.trim().toUpperCase() === normalized && e?.boughtDate && e?.tsn)
    .map(e => ({
      tsn: e.tsn,
      diff: Math.round(Math.abs((new Date(e.boughtDate) - target) / 86400000)),
    }))
    .filter(e => e.diff <= maxDays)
    .sort((a, b) => a.diff - b.diff)[0];
  return candidate?.tsn || null;
};
export const annG         = (pl, amt, d) => (amt && d && d !== "—") ? ((pl / amt) / (d / 365) * 100).toFixed(2) : null;
export const monG         = (pl, amt, d) => (amt && d && d !== "—") ? ((pl / amt) / (d / 30)  * 100).toFixed(2) : null;

const avgByQty = (entries, fn) => {
  const sold = entries.filter(e => e && e.soldDate && e.buyAmt && e.soldAmt && e.qty);
  const totalQty = sold.reduce((sum, e) => sum + (Number(e.qty) || 0), 0);
  if (!totalQty) return null;
  const weighted = sold.reduce((sum, e) => {
    const d = holdDays(e.boughtDate, e.soldDate);
    if (d === "—" || d <= 0) return sum;
    const pl = Number(e.soldAmt || 0) - Number(e.buyAmt || 0);
    return sum + (Number(e.qty) || 0) * fn(pl, Number(e.buyAmt || 0), d);
  }, 0);
  return Number.isFinite(weighted) ? (weighted / totalQty).toFixed(2) : null;
};

export const groupAnnG = entries => avgByQty(entries, annG);
export const groupMonG = entries => avgByQty(entries, monG);

export const secBadge = s => {
  const m = {
    Finance: "finance", Banking: "banking", IT: "it", Hydro: "it",
    Manufacturing: "it", Microfinance: "finance", "Dev Bank": "banking",
    "Life Insurance": "gold", "Non Life Insurance": "gold", "Mutual Fund": "gold",
  };
  return "badge badge--" + (m[s] || "default");
};

// ── LOCAL STORAGE ─────────────────────────────────────────
export const loadFromStorage = (key, defaultValue) => {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch {
    return defaultValue;
  }
};

export const saveToStorage = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`Failed to save ${key} to storage:`, e);
  }
};