// src/controllers/journalController.js
//
// CHANGES:
//   • getInvestmentTrades — now saves WACC-sourced investment records into
//     `investmententries` before returning them to the frontend, using the
//     same waccId-based dedup pattern that getJournalTrades uses for journal
//     entries. On first load each WACC investment record is inserted once;
//     on subsequent loads the saved document is returned directly (no
//     duplicate inserts). Live LTP/valueAsOfLtp are refreshed in-memory for
//     display but the DB record is NOT overwritten on every load — only
//     newly-seen WACC records are inserted.
//   • investmentEntrySchema must have waccId field (see investmentEntrySchema.js).
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

/**
 * assignTsnForManual
 *
 * Finds or creates a TSN for a manual Journal entry.
 *
 * Algorithm:
 *  1. Fetch all existing manual Journal entries for the same scrip that
 *     already have a TSN, optionally excluding the record being updated
 *     (excludeId) so it doesn't match itself.
 *  2. Among those candidates, search for any whose boughtDate is within
 *     12 calendar days of the new/updated boughtDate.
 *     - Candidates are tested in chronological order so the earliest
 *       matching group wins (stable grouping).
 *  3. If a matching candidate exists → reuse its TSN (no new TSN created).
 *  4. If no match → generate the next TSN (max across ALL entries + 1).
 *
 * @param {Model}  JournalEntry  - Mongoose model for the user's journalentries
 * @param {string} scrip         - Scrip symbol (will be normalised)
 * @param {string} boughtDate    - ISO date string of the trade being saved
 * @param {string} [excludeId]   - MongoDB _id string to exclude from search
 *                                 (pass the id of the record being updated)
 * @returns {Promise<string>}    - TSN string like "TSN001"
 */
async function assignTsnForManual(JournalEntry, scrip, boughtDate, excludeId = null) {
  const normalScrip = normalizeScript(scrip);

  // Build the query for same-scrip, manual-only candidates with a valid TSN.
  // Imported (MeroShare) entries must never be touched by this logic.
  const candidateQuery = {
    scrip:      normalScrip,
    origin:     "manual",          // only manual entries participate in grouping
    tsn:        { $exists: true, $ne: "" },
    boughtDate: { $ne: "" },
  };

  // When updating, exclude the record itself so it doesn't match its own TSN
  if (excludeId) {
    candidateQuery._id = { $ne: excludeId };
  }

  const candidates = await JournalEntry
    .find(candidateQuery)
    .select("tsn boughtDate")
    .sort({ boughtDate: 1 })   // chronological → earliest group wins
    .lean();

  if (boughtDate) {
    const newTime = new Date(boughtDate).getTime();
    const match = candidates.find((c) => {
      if (!c.boughtDate) return false;
      const diff = Math.abs(
        Math.round((newTime - new Date(c.boughtDate).getTime()) / 86400000)
      );
      return diff <= 12;
    });
    if (match) return match.tsn;
  }

  // No matching group found — allocate the next available TSN number.
  // Search across ALL entries (manual + imported) so we never reuse a number.
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
//   2. For any WACC record that does NOT yet have a saved journalentry,
//      assign a TSN and INSERT a new journalentry (origin:"ms") right now.
//   3. From that point on, every load reads the same saved document — TSN
//      never changes.
//
exports.getJournalTrades = async (req, res) => {
  try {
    const username = getUserName(req);
    const Wacc          = getModel(username, "waccs");
    const PortfolioItem = getModel(username, "portfolioitems");
    const JournalEntry  = getModel(username, "journalentries");

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

    // Build a lookup: waccId → saved journal entry (for imported trades already persisted)
    const savedByWaccId = {};
    importedEntries.forEach((e) => {
      if (e.waccId) savedByWaccId[e.waccId] = e;
    });

    // Start TSN counter above the highest number already used anywhere in the DB
    let tsnCounter = getNextTsnCounter(allEntries);

    // Used for grouping nearby same-scrip WACC records into the same TSN
    const tsnHistory = {}; // scrip → [{ tsn, boughtDate }]

    // Collect new entries that need to be persisted for the first time
    const toInsert = [];

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
          // ✅ Already saved — just return the saved document.
          // Update live price fields in-memory for display (don't re-save on every load).
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

        return {
          id: `ms_${waccId}`, // temporary id — replaced after insert
          ...newDoc,
        };
      });

    // Persist all new imported entries to journalentries in one batch
    if (toInsert.length > 0) {
      const inserted = await JournalEntry.insertMany(toInsert, { ordered: false });

      const insertedByWaccId = {};
      inserted.forEach((doc) => { insertedByWaccId[doc.waccId] = doc._id.toString(); });

      waccJournalRecords.forEach((r) => {
        if (r.id && r.id.startsWith("ms_")) {
          const wid = r.id.replace("ms_", "");
          if (insertedByWaccId[wid]) r.id = insertedByWaccId[wid];
        }
      });
    }

    const manualTrades = manualEntries.map(mapJournalEntry);
    const trades = [...manualTrades, ...waccJournalRecords];

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

        return {
          id: `ms_${script}`, // temporary id — replaced after insert
          ...newDoc,
        };
      });

    // Persist all new imported investment entries in one batch
    if (toInsert.length > 0) {
      const inserted = await InvestmentEntry.insertMany(toInsert, { ordered: false });

      // Build lookup: scrip → real MongoDB _id
      const insertedByScrip = {};
      inserted.forEach((doc) => { insertedByScrip[doc.scrip] = doc._id.toString(); });

      waccInvestmentRecords.forEach((r) => {
        if (r.id && r.id.startsWith("ms_")) {
          const scrip = r.id.replace("ms_", "");
          if (insertedByScrip[scrip]) r.id = insertedByScrip[scrip];
        }
      });
    }

    const manualTrades     = manualEntries.map(mapInvestmentEntry);
    const investmentTrades = [...manualTrades, ...waccInvestmentRecords];

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
    const id           = req.params.id;

    // Load the existing record first so we can detect field changes
    const existing = await JournalEntry.findById(id).lean();
    if (!existing) {
      return res.status(404).json({ success: false, message: "Journal entry not found." });
    }

    // Determine whether scrip or boughtDate has changed — only then recalculate TSN.
    // Imported (MeroShare) entries are never manually edited in practice, but
    // we guard with the origin check to be absolutely safe.
    const incomingScrip      = normalizeScript(payload.scrip || existing.scrip || "");
    const incomingBoughtDate = (payload.boughtDate !== undefined ? payload.boughtDate : existing.boughtDate) || "";
    const existingScrip      = normalizeScript(existing.scrip || "");
    const existingBoughtDate = existing.boughtDate || "";

    const scripChanged      = incomingScrip      !== existingScrip;
    const boughtDateChanged = incomingBoughtDate !== existingBoughtDate;
    const isManual          = (existing.origin || "manual") === "manual";

    let tsnUpdate = {};

    if (isManual && (scripChanged || boughtDateChanged)) {
      // Recalculate TSN from scratch, excluding this record so it doesn't
      // match its own (now-stale) TSN group.
      const newTsn = await assignTsnForManual(
        JournalEntry,
        incomingScrip,
        incomingBoughtDate,
        id                // ← exclude self
      );
      tsnUpdate = { tsn: newTsn };
    }

    const entry = await JournalEntry.findByIdAndUpdate(
      id,
      { ...payload, ...tsnUpdate, imported: false, origin: "manual" },
      { new: true, runValidators: true }
    ).lean();

    if (!entry) {
      return res.status(404).json({ success: false, message: "Journal entry not found." });
    }

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
      { ...payload, imported: false, origin: "manual" },
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