import { useState } from "react";
import { JournalTable } from "../components/JournalTable";
import { TradeHistoryModal } from "../components/TradeHistoryModal";
import { isAgedOutTrade } from "../utils/helpers";
import "../styles/journal.css";

// ── JOURNAL TAB ───────────────────────────────────────────
// Props:
//   trades       – array of all trade objects
//   onScripClick – open detail modal for the clicked trade

export function Journal({ trades, onScripClick }) {
  const [showHistory, setShowHistory] = useState(false);

  // Sold trades that are 30+ days old move to the History view.
  // Nothing is deleted/modified in the DB — purely a display filter.
  const visibleTrades = trades.filter(t => !isAgedOutTrade(t));

  const sortedTrades = [...visibleTrades].sort((a, b) => {
    const dateCompare = (a.boughtDate || "").localeCompare(b.boughtDate || "");
    return dateCompare || (a.tsn || "").localeCompare(b.tsn || "");
  });

  return (
    <div className="card--np">
      <div className="card__header">
        <div>
          <div className="card__title">Trade Journal</div>
          <div className="card__sub">Click any SCRIPT to view · Edit · Delete</div>
        </div>
        <div className="journal-header__right">
          <button className="btn btn--history" onClick={() => setShowHistory(true)}>
            🕘 History
          </button>
          <span className="card__count">{visibleTrades.length} trades</span>
        </div>
      </div>
      <JournalTable trades={sortedTrades} onScripClick={onScripClick} />

      {showHistory && (
        <TradeHistoryModal
          trades={trades}
          onScripClick={onScripClick}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}