// src/controllers/journalController.js
//
// JOURNAL:
//   • Imported (MeroShare/WACC) trades are saved to journalentries on first load.
//   • On every load, any ms-origin entry older than 60 days is auto-moved
//     to investmententries (manual entries are never auto-moved).
//   • TSN is assigned once on first save and never changes.
//
// INVESTMENT:
//   • WACC records bucketed as "investment" (holding >60 days) are saved
//     to investmententries on first load using a composite waccId as dedup key.
//   • Manual investment entries are never touched by auto-move logic.
//
const { getModel } = require("../utils/userCollections");
const logger       = require("../utils/logger");

// 2 months expressed in days (used for journal vs investment bucketing)
const HOLDING_THRESHOLD_DAYS = 60;

function getUserName(req) {
  return req.user.name;
}

function normalizeScript(value) {
  return String(value || "").trim().toUpperCase();
}

function diffDays(a, b = new Date()) {
  if (!a) return 0;
  const left  = new Date(a);
  const right = new Date(b);
  return Math.round((right - left) / 86400000);
}

function buildWaccIndex(records) {
  return records.reduce((acc, rec) => {
    const scrip = normalizeScript(rec.scrip);
    if (!scrip) return acc;
    acc[scrip] = acc[scrip] || [];
    acc[scrip].push(rec);
    return acc;
  }, {});
}

function buildPortfolioIndex(items) {
  return items.reduce((acc, item) => {
    const scrip = normalizeScript(item.script);
    if (!scrip) return acc;
    acc[scrip] = item;
    return acc;
  }, {});
}

function getHoldingAge(scriptRecords) {
  const dates = (scriptRecords || [])
    .map((r) => r.transactionDate)
    .filter(Boolean)
    .map((d) => new Date(d).getTime());

  if (!dates.length) return 0;
  const earliest = new Date(Math.min(...dates));
  return diffDays(earliest, new Date());
}

// Returns { script → "journal" | "investment" } for every script
// that appears in either waccRecords or portfolioItems.
// Rule: holdingAge > HOLDING_THRESHOLD_DAYS → "investment", else → "journal"
function getScriptBuckets(waccRecords, portfolioItems) {
  const waccIndex      = buildWaccIndex(waccRecords);
  const portfolioIndex = buildPortfolioIndex(portfolioItems);
  const scripts = new Set([
    ...Object.keys(waccIndex),
    ...Object.keys(portfolioIndex),
  ]);

  const buckets = {};
  scripts.forEach((script) => {
    const holdingDays = getHoldingAge(waccIndex[script]);
    buckets[script] = holdingDays > HOLDING_THRESHOLD_DAYS ? "investment" : "journal";
  });

  return buckets;
}

// ── TSN HELPERS ───────────────────────────────────────────────────────────────

function getNextTsnCounter(allEntries) {
  let maxNum = 0;
  allEntries.forEach(({ tsn }) => {
    const n = parseInt((tsn || "").replace(/^TSN/i, ""), 10);
    if (!isNaN(n) && n > maxNum) maxNum = n;
  });
  return maxNum + 1;
}

async function assignTsnForManual(JournalEntry, scrip, boughtDate) {
  const normalScrip = normalizeScript(scrip);

  const candidates = await JournalEntry.find({
    scrip:      normalScrip,
    tsn:        { $exists: true, $ne: "" },
    boughtDate: { $ne: "" },
  }).select("tsn boughtDate").lean();

  if (boughtDate) {
    const newTime = new Date(boughtDate).getTime();
    const match = candidates
      .slice()
      .reverse()
      .find((c) => {
        const diff = Math.abs(Math.round((newTime - new Date(c.boughtDate).getTime()) / 86400000));
        return diff <= 12;
      });
    if (match) return match.tsn;
  }

  const all     = await JournalEntry.find({ tsn: { $regex: /^TSN\d+$/i } }).select("tsn").lean();
  const counter = getNextTsnCounter(all);
  return `TSN${String(counter).padStart(3, "0")}`;
}

function mapJournalEntry(entry) {
  return {
    id:           entry._id.toString(),
    tsn:          entry.tsn || "",
    scrip:        entry.scrip || "",
    qty:          Number(entry.qty || 0),
    buyRate:      Number(entry.buyRate || 0),
    sellRate:     Number(entry.sellRate || 0),
    buyAmt:       Number(entry.buyAmt || 0),
    soldAmt:      Number(entry.soldAmt || 0),
    ltp:          Number(entry.ltp || 0),
    valueAsOfLtp: Number(entry.valueAsOfLtp || 0),
    boughtDate:   entry.boughtDate || "",
    soldDate:     entry.soldDate || "",
    rr:           entry.rr || "—",
    remarks:      entry.remarks || "",
    imported:     !!entry.imported,
    origin:       entry.origin || "manual",
  };
}

function mapInvestmentEntry(entry) {
  return {
    id:           entry._id.toString(),
    scrip:        entry.scrip || "",
    sector:       entry.sector || "",
    qty:          Number(entry.qty || 0),
    buyRate:      Number(entry.buyRate || 0),
    soldRate:     entry.soldRate != null ? Number(entry.soldRate) : null,
    buyAmt:       Number(entry.buyAmt || 0),
    soldAmt:      entry.soldAmt != null ? Number(entry.soldAmt || 0) : null,
    ltp:          Number(entry.ltp || 0),
    valueAsOfLtp: Number(entry.valueAsOfLtp || 0),
    boughtDate:   entry.boughtDate || "",
    soldDate:     entry.soldDate || "",
    remarks:      entry.remarks || "",
    imported:     !!entry.imported,
    origin:       entry.origin || "manual",
  };
}

// ── GET JOURNAL TRADES ────────────────────────────────────────────────────────
//
// Strategy for imported (MeroShare) trades:
//   1. Load all existing journalentries that have origin:"ms" — these are
//      already saved with a stable TSN, treat them as-is.
//   2. AUTO-MOVE: For any saved ms-origin journal entry whose boughtDate is
//      now MORE than 60 days ago → move it to investmententries automatically.
//      (Only ms-origin entries move. Manual entries never auto-move.)
//   3. For any WACC record that does NOT yet have a saved journalentry,
//      assign a TSN and INSERT a new journalentry (origin:"ms") right now.
//   4. From that point on, every load reads the same saved document.
//
exports.getJournalTrades = async (req, res) => {
  try {
    const username = getUserName(req);
    const Wacc          = getModel(username, "waccs");
    const PortfolioItem = getModel(username, "portfolioitems");
    const JournalEntry  = getModel(username, "journalentries");
    const InvestmentEntry = getModel(username, "investmententries");

    const [waccRecords, portfolioItems, allEntries] = await Promise.all([
      Wacc.find()
        .sort({ transactionDate: 1 })
        .select("scrip transactionQuantity rate transactionDate purchaseSource isin boid")
        .lean(),
      PortfolioItem.find()
        .select("script lastTransactionPrice valueOfLastTransPrice currentBalance")
        .lean(),
      JournalEntry.find()
        .sort({ createdAt: 1 })
        .lean(),
    ]);

    const buckets      = getScriptBuckets(waccRecords, portfolioItems);
    const portfolioMap = buildPortfolioIndex(portfolioItems);

    // Split existing entries into manual and already-saved imported ones
    const manualEntries   = allEntries.filter((e) => e.origin !== "ms");
    const importedEntries = allEntries.filter((e) => e.origin === "ms");

    // ── AUTO-MOVE: ms-origin journal entries that crossed 60 days ─────────
    // For each imported journal entry, check if boughtDate is now >60 days ago.
    // If yes → remove from journalentries, insert into investmententries.
    const toAutoMove = importedEntries.filter((e) => {
      if (!e.boughtDate) return false;
      return diffDays(e.boughtDate, new Date()) > HOLDING_THRESHOLD_DAYS;
    });

    if (toAutoMove.length > 0) {
      logger.info(`  → Auto-moving ${toAutoMove.length} journal entry/entries to investment (>60 days).`);

      for (const entry of toAutoMove) {
        // Build investment doc from the journal entry's data
        // Check if an investment entry for this waccId already exists (avoid duplicate)
        const existing = entry.waccId
          ? await InvestmentEntry.findOne({ waccId: entry.waccId }).lean()
          : null;

        if (!existing) {
          await InvestmentEntry.create({
            scrip:        entry.scrip,
            sector:       "",
            qty:          entry.qty,
            buyRate:      entry.buyRate,
            soldRate:     entry.sellRate && entry.sellRate > 0 ? entry.sellRate : null,
            buyAmt:       entry.buyAmt,
            soldAmt:      entry.soldAmt && entry.soldAmt > 0 ? entry.soldAmt : null,
            ltp:          entry.ltp,
            valueAsOfLtp: entry.valueAsOfLtp,
            boughtDate:   entry.boughtDate,
            soldDate:     entry.soldDate || null,
            remarks:      entry.remarks || "",
            imported:     entry.imported,
            origin:       "ms",
            waccId:       entry.waccId || "",
          });
        }

        // Remove from journalentries
        await JournalEntry.findByIdAndDelete(entry._id);
      }
    }

    // Reload journal entries after auto-move (some were deleted above)
    const remainingEntries = toAutoMove.length > 0
      ? await JournalEntry.find().sort({ createdAt: 1 }).lean()
      : allEntries;

    const remainingManual   = remainingEntries.filter((e) => e.origin !== "ms");
    const remainingImported = remainingEntries.filter((e) => e.origin === "ms");

    // Build a lookup: waccId → saved journal entry
    const savedByWaccId = {};
    remainingImported.forEach((e) => {
      if (e.waccId) savedByWaccId[e.waccId] = e;
    });

    // Start TSN counter above the highest number already used anywhere in the DB
    let tsnCounter = getNextTsnCounter(remainingEntries);

    const tsnHistory = {}; // scrip → [{ tsn, boughtDate }]
    const toInsert   = [];

    // Build the full list of WACC-sourced journal records
    const waccJournalRecords = waccRecords
      .filter((w) => buckets[normalizeScript(w.scrip)] === "journal")
      .map((w) => {
        const scrip      = normalizeScript(w.scrip);
        const waccId     = String(w._id);
        const boughtDate = w.transactionDate
          ? new Date(w.transactionDate).toISOString().slice(0, 10)
          : "";

        const qty          = Number(w.transactionQuantity) || 0;
        const buyRate      = Number(w.rate) || 0;
        const buyAmt       = qty && buyRate ? qty * buyRate : 0;
        const live         = portfolioMap[scrip] || {};
        const ltp          = Number(live.lastTransactionPrice || 0) || 0;
        const valueAsOfLtp = Number(live.valueOfLastTransPrice || 0) || (qty * ltp);

        if (savedByWaccId[waccId]) {
          const saved = savedByWaccId[waccId];
          return {
            ...mapJournalEntry(saved),
            ltp,
            valueAsOfLtp,
          };
        }

        // 🆕 First time — assign a TSN and queue for saving.
        const recent = tsnHistory[scrip]?.slice().reverse().find((h) => {
          if (!h.boughtDate || !boughtDate) return false;
          return Math.abs(Math.round((new Date(boughtDate) - new Date(h.boughtDate)) / 86400000)) <= 12;
        });

        const tsn = recent?.tsn || `TSN${String(tsnCounter++).padStart(3, "0")}`;
        tsnHistory[scrip] = [...(tsnHistory[scrip] || []), { tsn, boughtDate }];

        const newDoc = {
          tsn,
          scrip,
          qty,
          buyRate,
          sellRate:     0,
          buyAmt,
          soldAmt:      0,
          ltp,
          valueAsOfLtp,
          boughtDate,
          soldDate:     "",
          rr:           "—",
          remarks:      w.purchaseSource ? `Source: ${w.purchaseSource}` : "",
          imported:     true,
          origin:       "ms",
          waccId,
        };

        toInsert.push(newDoc);
        return null; // placeholder — replaced after insert
      });

    // Persist all new imported entries first, then build response with real _ids
    if (toInsert.length > 0) {
      const inserted = await JournalEntry.insertMany(toInsert, { ordered: false });
      let insertIdx = 0;
      for (let i = 0; i < waccJournalRecords.length; i++) {
        if (waccJournalRecords[i] === null) {
          const doc = inserted[insertIdx++];
          const live = portfolioMap[normalizeScript(doc.scrip)] || {};
          waccJournalRecords[i] = {
            ...mapJournalEntry(doc),
            ltp:          Number(live.lastTransactionPrice || 0) || 0,
            valueAsOfLtp: Number(live.valueOfLastTransPrice || 0) || 0,
          };
        }
      }
    }

    // ── Portfolio scripts with NO WACC record ──────────────────────────────
    // These exist in MS Portfolio but MeroShare returned no WACC for them.
    // Create a placeholder journal entry so they still appear in the UI.
    const waccScripts = new Set(waccRecords.map((w) => normalizeScript(w.scrip)));
    const portfolioOnlyJournal = [];

    for (const item of portfolioItems) {
      const scrip = normalizeScript(item.script);
      if (!scrip || waccScripts.has(scrip)) continue;           // handled by WACC loop
      if (buckets[scrip] !== "journal") continue;               // goes to investment tab
      const alreadySaved = remainingEntries.some(
        (e) => normalizeScript(e.scrip) === scrip && e.origin === "ms"
      );
      if (alreadySaved) {
        const saved = remainingEntries.find(
          (e) => normalizeScript(e.scrip) === scrip && e.origin === "ms"
        );
        const ltp = Number(item.lastTransactionPrice || 0) || 0;
        const valueAsOfLtp = Number(item.valueOfLastTransPrice || 0) || 0;
        portfolioOnlyJournal.push({ ...mapJournalEntry(saved), ltp, valueAsOfLtp });
        continue;
      }

      const qty          = Number(item.currentBalance || 0);
      const ltp          = Number(item.lastTransactionPrice || 0) || 0;
      const valueAsOfLtp = Number(item.valueOfLastTransPrice || 0) || (qty * ltp);
      const tsn          = `TSN${String(tsnCounter++).padStart(3, "0")}`;

      const newDoc = {
        tsn, scrip, qty,
        buyRate: 0, sellRate: 0, buyAmt: 0, soldAmt: 0,
        ltp, valueAsOfLtp,
        boughtDate: "", soldDate: "", rr: "—",
        remarks: "No WACC data — imported from portfolio",
        imported: true, origin: "ms", waccId: `portfolio_${scrip}`,
      };

      try {
        const inserted = await JournalEntry.create(newDoc);
        portfolioOnlyJournal.push({ ...newDoc, id: inserted._id.toString() });
      } catch (e) {
        portfolioOnlyJournal.push({ id: `ms_portfolio_${scrip}`, ...newDoc });
      }
    }

    const manualTrades = remainingManual.map(mapJournalEntry);
    const trades = [...manualTrades, ...waccJournalRecords, ...portfolioOnlyJournal];

    res.json({ success: true, total: trades.length, data: trades });
  } catch (e) {
    logger.error(e);
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── GET INVESTMENT TRADES ─────────────────────────────────────────────────────
//
// Strategy for imported (MeroShare) investment trades:
//   1. Load all existing investmententries that have origin:"ms" and a waccId
//      — these are already saved in the DB, return them as-is.
//   2. For any WACC record (bucketed as "investment") that does NOT yet have a
//      saved investmententry (checked via waccId), INSERT a new investmententry
//      (origin:"ms") right now and return the saved document.
//   3. From that point on, every load reads from DB — no on-the-fly construction.
//
// NOTE: Investment entries are aggregated per-script (all WACC records for the
//       same script are merged into a single per-script investment row), because
//       a portfolio position is one holding even if built from multiple purchases.
//       The waccId stored is a JSON-stringified sorted array of all contributing
//       WACC record IDs, used as the dedup key.
//
exports.getInvestmentTrades = async (req, res) => {
  try {
    const username = getUserName(req);
    const Wacc           = getModel(username, "waccs");
    const PortfolioItem  = getModel(username, "portfolioitems");
    const InvestmentEntry = getModel(username, "investmententries");

    const [waccRecords, portfolioItems, allEntries] = await Promise.all([
      Wacc.find()
        .sort({ transactionDate: 1 })
        .select("scrip transactionQuantity rate transactionDate purchaseSource isin boid")
        .lean(),
      PortfolioItem.find()
        .select("script currentBalance lastTransactionPrice valueOfLastTransPrice")
        .lean(),
      InvestmentEntry.find()
        .sort({ createdAt: 1 })
        .lean(),
    ]);

    const buckets      = getScriptBuckets(waccRecords, portfolioItems);
    const portfolioMap = buildPortfolioIndex(portfolioItems);
    const waccIndex    = buildWaccIndex(waccRecords);

    // Split: manual entries (no waccId or origin !== "ms") vs imported
    const manualEntries   = allEntries.filter((e) => e.origin !== "ms");
    const importedEntries = allEntries.filter((e) => e.origin === "ms");

    // Build lookup: waccId (the composite key string) → saved investment entry
    // waccId for investment entries is a JSON array string of sorted WACC _ids
    const savedByWaccId = {};
    importedEntries.forEach((e) => {
      if (e.waccId) savedByWaccId[e.waccId] = e;
    });

    const toInsert = [];

    // Build one investment row per script that is bucketed as "investment"
    const waccInvestmentRecords = Object.entries(portfolioMap)
      .filter(([script]) => buckets[script] === "investment")
      .map(([script, portfolio]) => {
        const records = waccIndex[script] || [];

        // Composite waccId = sorted array of all contributing WACC _ids
        const compositeWaccId = JSON.stringify(
          records.map((r) => String(r._id)).sort()
        );

        const qty          = Number(portfolio.currentBalance || 0);
        const ltp          = Number(portfolio.lastTransactionPrice || 0);
        const valueAsOfLtp = Number(portfolio.valueOfLastTransPrice || 0) || (qty * ltp);

        // Weighted-average buy rate across all WACC records
        const positiveQty = records.reduce(
          (sum, r) => sum + Math.max(0, Number(r.transactionQuantity) || 0), 0
        );
        const totalCost = records.reduce(
          (sum, r) => sum + (Math.max(0, Number(r.transactionQuantity) || 0) * Number(r.rate || 0)),
          0
        );
        const buyRate  = positiveQty ? totalCost / positiveQty : 0;
        const buyAmt   = qty && buyRate ? qty * buyRate : 0;

        const earliestDate = records
          .map((r) => r.transactionDate)
          .filter(Boolean)
          .map((d) => new Date(d).getTime())
          .sort((a, b) => a - b)[0];

        const boughtDate = earliestDate
          ? new Date(earliestDate).toISOString().slice(0, 10)
          : "";

        const remarks = records.length
          ? `Source: ${records[0].purchaseSource || "MeroShare"}`
          : "Imported from MeroShare";

        if (savedByWaccId[compositeWaccId]) {
          // ✅ Already saved in investmententries — return saved document.
          // Refresh live price fields in-memory for display only.
          const saved = savedByWaccId[compositeWaccId];
          return {
            ...mapInvestmentEntry(saved),
            ltp,
            valueAsOfLtp,
          };
        }

        // 🆕 First time — queue for saving to investmententries.
        const newDoc = {
          scrip:        script,
          sector:       "",
          qty,
          buyRate,
          soldRate:     null,
          buyAmt,
          soldAmt:      null,
          ltp,
          valueAsOfLtp,
          boughtDate,
          soldDate:     null,
          remarks,
          imported:     true,
          origin:       "ms",
          waccId:       compositeWaccId,
        };

        toInsert.push(newDoc);
        return null; // placeholder — replaced after insert
      });

    // Persist all new imported investment entries first, then return real _ids
    if (toInsert.length > 0) {
      const inserted = await InvestmentEntry.insertMany(toInsert, { ordered: false });
      let insertIdx = 0;
      for (let i = 0; i < waccInvestmentRecords.length; i++) {
        if (waccInvestmentRecords[i] === null) {
          const doc = inserted[insertIdx++];
          const live = portfolioMap[normalizeScript(doc.scrip)] || {};
          waccInvestmentRecords[i] = {
            ...mapInvestmentEntry(doc),
            ltp:          Number(live.lastTransactionPrice || 0) || 0,
            valueAsOfLtp: Number(live.valueOfLastTransPrice || 0) || 0,
          };
        }
      }
    }

    // ── Portfolio scripts with NO WACC record (investment bucket) ──────────
    const waccScriptsInv = new Set(waccRecords.map((w) => normalizeScript(w.scrip)));
    const portfolioOnlyInvest = [];

    for (const item of portfolioItems) {
      const scrip = normalizeScript(item.script);
      if (!scrip || waccScriptsInv.has(scrip)) continue;       // handled by WACC loop
      if (buckets[scrip] !== "investment") continue;            // goes to journal tab
      const alreadySaved = allEntries.some(
        (e) => normalizeScript(e.scrip) === scrip && e.origin === "ms"
      );
      if (alreadySaved) {
        const saved = allEntries.find(
          (e) => normalizeScript(e.scrip) === scrip && e.origin === "ms"
        );
        const ltp = Number(item.lastTransactionPrice || 0) || 0;
        const valueAsOfLtp = Number(item.valueOfLastTransPrice || 0) || 0;
        portfolioOnlyInvest.push({ ...mapInvestmentEntry(saved), ltp, valueAsOfLtp });
        continue;
      }

      const qty          = Number(item.currentBalance || 0);
      const ltp          = Number(item.lastTransactionPrice || 0) || 0;
      const valueAsOfLtp = Number(item.valueOfLastTransPrice || 0) || (qty * ltp);

      const newDoc = {
        scrip, sector: "", qty,
        buyRate: 0, soldRate: null, buyAmt: 0, soldAmt: null,
        ltp, valueAsOfLtp, boughtDate: "", soldDate: null,
        remarks: "No WACC data — imported from portfolio",
        imported: true, origin: "ms", waccId: `portfolio_${scrip}`,
      };

      try {
        const inserted = await InvestmentEntry.create(newDoc);
        portfolioOnlyInvest.push({ ...mapInvestmentEntry(inserted), ltp, valueAsOfLtp });
      } catch (e) {
        portfolioOnlyInvest.push({ id: `ms_portfolio_${scrip}`, ...newDoc });
      }
    }

    const manualTrades     = manualEntries.map(mapInvestmentEntry);
    const investmentTrades = [...manualTrades, ...waccInvestmentRecords, ...portfolioOnlyInvest];

    res.json({ success: true, total: investmentTrades.length, data: investmentTrades });
  } catch (e) {
    logger.error(e);
    res.status(500).json({ success: false, message: e.message });
  }
};

function parseBody(body) {
  const parsed = { ...body };
  if (parsed.qty != null)          parsed.qty          = Number(parsed.qty)          || 0;
  if (parsed.buyRate != null)      parsed.buyRate      = Number(parsed.buyRate)      || 0;
  if (parsed.sellRate != null)     parsed.sellRate     = parsed.sellRate === ""  ? 0    : Number(parsed.sellRate)  || 0;
  if (parsed.soldRate != null)     parsed.soldRate     = parsed.soldRate === ""  ? null : Number(parsed.soldRate);
  if (parsed.buyAmt != null)       parsed.buyAmt       = Number(parsed.buyAmt)       || 0;
  if (parsed.soldAmt != null)      parsed.soldAmt      = parsed.soldAmt === ""   ? null : Number(parsed.soldAmt);
  if (parsed.ltp != null)          parsed.ltp          = Number(parsed.ltp)          || 0;
  if (parsed.valueAsOfLtp != null) parsed.valueAsOfLtp = Number(parsed.valueAsOfLtp) || 0;
  return parsed;
}

// ── CREATE / UPDATE / DELETE — Journal ───────────────────────────────────────

exports.createJournalTrade = async (req, res) => {
  try {
    const username     = getUserName(req);
    const JournalEntry = getModel(username, "journalentries");
    const payload      = parseBody(req.body);

    // Auto-generate TSN — groups with same-scrip entry within 12 days
    const tsn = await assignTsnForManual(
      JournalEntry,
      payload.scrip || "",
      payload.boughtDate || ""
    );

    const entry = await JournalEntry.create({
      ...payload,
      tsn,
      waccId:   "",
      imported: false,
      origin:   "manual",
    });
    res.json({ success: true, data: mapJournalEntry(entry) });
  } catch (e) {
    logger.error(e);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.updateJournalTrade = async (req, res) => {
  try {
    const username     = getUserName(req);
    const JournalEntry = getModel(username, "journalentries");
    const payload      = parseBody(req.body);
    const entry = await JournalEntry.findByIdAndUpdate(
      req.params.id,
      { ...payload },
      { new: true, runValidators: true }
    ).lean();
    if (!entry) return res.status(404).json({ success: false, message: "Journal entry not found." });
    res.json({ success: true, data: mapJournalEntry(entry) });
  } catch (e) {
    logger.error(e);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.deleteJournalTrade = async (req, res) => {
  try {
    const username     = getUserName(req);
    const JournalEntry = getModel(username, "journalentries");
    const entry = await JournalEntry.findByIdAndDelete(req.params.id).lean();
    if (!entry) return res.status(404).json({ success: false, message: "Journal entry not found." });
    res.json({ success: true, data: null });
  } catch (e) {
    logger.error(e);
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── CREATE / UPDATE / DELETE — Investment ────────────────────────────────────

exports.createInvestmentTrade = async (req, res) => {
  try {
    const username        = getUserName(req);
    const InvestmentEntry = getModel(username, "investmententries");
    const payload         = parseBody(req.body);
    const entry = await InvestmentEntry.create({
      ...payload,
      waccId:   "",
      imported: false,
      origin:   "manual",
    });
    res.json({ success: true, data: mapInvestmentEntry(entry) });
  } catch (e) {
    logger.error(e);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.updateInvestmentTrade = async (req, res) => {
  try {
    const username        = getUserName(req);
    const InvestmentEntry = getModel(username, "investmententries");
    const payload         = parseBody(req.body);
    const entry = await InvestmentEntry.findByIdAndUpdate(
      req.params.id,
      { ...payload },
      { new: true, runValidators: true }
    ).lean();
    if (!entry) return res.status(404).json({ success: false, message: "Investment entry not found." });
    res.json({ success: true, data: mapInvestmentEntry(entry) });
  } catch (e) {
    logger.error(e);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.deleteInvestmentTrade = async (req, res) => {
  try {
    const username        = getUserName(req);
    const InvestmentEntry = getModel(username, "investmententries");
    const entry = await InvestmentEntry.findByIdAndDelete(req.params.id).lean();
    if (!entry) return res.status(404).json({ success: false, message: "Investment entry not found." });
    res.json({ success: true, data: null });
  } catch (e) {
    logger.error(e);
    res.status(500).json({ success: false, message: e.message });
  }
};