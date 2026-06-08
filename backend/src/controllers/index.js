// src/controllers/index.js
//
// CHANGES FROM ORIGINAL:
//   • Added refreshPortfolio() — calls runPortfolioSync() which fetches
//     ONLY portfolioitems + portfoliosummaries (LTP / current values).
//     Uses the stored MeroShare session token; never the hashed password.
//     Returns the fresh portfolio from MongoDB after the sync completes.
//
const { getModel }         = require("../utils/userCollections");
const { runPortfolioSync } = require("../services/syncService");
const logger               = require("../utils/logger");

const ok  = (res, data, meta = {}) => res.json({ success: true, ...meta, data });
const err = (res, message, status = 500) =>
  res.status(status).json({ success: false, message });

function getUserName(req) {
  return req.user.name;
}

// ── Profile ───────────────────────────────────────────────────────────
exports.getProfile = async (req, res) => {
  try {
    const UserProfile = getModel(getUserName(req), "userprofiles");
    const profile = await UserProfile.findOne().sort({ updatedAt: -1 }).lean();
    if (!profile) return err(res, "No profile found. Run a sync first.", 404);
    ok(res, profile);
  } catch (e) {
    logger.error(e);
    err(res, e.message, e.status || 500);
  }
};

// ── Shares ────────────────────────────────────────────────────────────
exports.getShares = async (req, res) => {
  try {
    const Share  = getModel(getUserName(req), "shares");
    const shares = await Share.find()
      .sort({ script: 1 })
      .select("-__v -createdAt -updatedAt")
      .lean();
    ok(res, shares, { total: shares.length });
  } catch (e) {
    logger.error(e);
    err(res, e.message, e.status || 500);
  }
};

exports.getShareByScript = async (req, res) => {
  try {
    const Share = getModel(getUserName(req), "shares");
    const share = await Share.findOne({ script: req.params.script.toUpperCase() })
      .select("-__v -createdAt -updatedAt")
      .lean();
    if (!share) return err(res, `Share '${req.params.script.toUpperCase()}' not found.`, 404);
    ok(res, share);
  } catch (e) {
    logger.error(e);
    err(res, e.message, e.status || 500);
  }
};

// ── Portfolio ─────────────────────────────────────────────────────────
exports.getPortfolio = async (req, res) => {
  try {
    const PortfolioSummary = getModel(getUserName(req), "portfoliosummaries");
    const PortfolioItem    = getModel(getUserName(req), "portfolioitems");
    const [summary, items] = await Promise.all([
      PortfolioSummary.findOne().select("-__v -createdAt -updatedAt").lean(),
      PortfolioItem.find().sort({ script: 1 }).select("-__v -createdAt -updatedAt").lean(),
    ]);
    ok(res, { summary, items }, { total: items.length });
  } catch (e) {
    logger.error(e);
    err(res, e.message, e.status || 500);
  }
};

// ── Portfolio Refresh (browser refresh — LTP/current value update) ────
//
// Flow:
//   Browser Refresh
//     ↓ POST /api/portfolio/refresh
//     ↓ runPortfolioSync() → calls MeroShare portfolio APIs
//     ↓ Updates MongoDB (portfolioitems + portfoliosummaries)
//     ↓ Returns fresh data from MongoDB
//     ↓ Frontend displays updated portfolio
//
// Rules:
//   • Only portfolioitems and portfoliosummaries are updated.
//   • Profile, Shares, WACC, Applicable Issues are NOT re-fetched.
//   • Uses stored meroshareToken — NEVER the bcrypt-hashed password.
//   • If the MeroShare session is expired, returns 401 with a clear message.
//
exports.refreshPortfolio = async (req, res) => {
  try {
    const userId   = req.user.id;
    const userName = getUserName(req);

    logger.info(`🔄 Portfolio refresh requested by: ${userName}`);

    try {
      await runPortfolioSync({ userId, name: userName });
    } catch (syncErr) {
      if (syncErr.message.includes("session expired")) {
        return res.status(401).json({
          success:        false,
          message:        syncErr.message,
          sessionExpired: true,
        });
      }
      throw syncErr;
    }

    // Return the freshly updated portfolio from MongoDB
    const PortfolioSummary = getModel(userName, "portfoliosummaries");
    const PortfolioItem    = getModel(userName, "portfolioitems");
    const [summary, items] = await Promise.all([
      PortfolioSummary.findOne().select("-__v -createdAt -updatedAt").lean(),
      PortfolioItem.find().sort({ script: 1 }).select("-__v -createdAt -updatedAt").lean(),
    ]);

    logger.info(`✅ Portfolio refresh complete for: ${userName} (${items.length} items)`);
    ok(res, { summary, items }, { total: items.length, refreshed: true });

  } catch (e) {
    logger.error(e);
    err(res, e.message, e.status || 500);
  }
};

// ── Applicable Issues ─────────────────────────────────────────────────
exports.getApplicableIssues = async (req, res) => {
  try {
    const ApplicableIssue = getModel(getUserName(req), "applicableissues");
    const { type }  = req.query;
    const filter    = type ? { shareTypeName: new RegExp(type, "i") } : {};
    const issues    = await ApplicableIssue.find(filter)
      .sort({ issueOpenDate: -1 })
      .select("-__v -createdAt -updatedAt")
      .lean();
    ok(res, issues, { total: issues.length });
  } catch (e) {
    logger.error(e);
    err(res, e.message, e.status || 500);
  }
};

// ── WACC ──────────────────────────────────────────────────────────────
exports.getWacc = async (req, res) => {
  try {
    const Wacc       = getModel(getUserName(req), "waccs");
    const { script } = req.query;
    const filter     = script ? { scrip: script.toUpperCase() } : {};
    const records    = await Wacc.find(filter)
      .sort({ transactionDate: -1 })
      .select("-__v -createdAt -updatedAt")
      .lean();
    ok(res, records, { total: records.length });
  } catch (e) {
    logger.error(e);
    err(res, e.message, e.status || 500);
  }
};

// ── Sync Logs ─────────────────────────────────────────────────────────
exports.getSyncLogs = async (req, res) => {
  try {
    const SyncLog = getModel(getUserName(req), "synclogs");
    const limit   = Math.min(Number(req.query.limit) || 10, 100);
    const logs    = await SyncLog.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .select("-__v")
      .lean();
    ok(res, logs, { total: logs.length });
  } catch (e) {
    logger.error(e);
    err(res, e.message, e.status || 500);
  }
};

// ── Manual Sync Trigger ───────────────────────────────────────────────
exports.triggerSync = async (req, res) => {
  try {
    logger.info("Manual sync triggered via API.");
    res.json({ success: true, message: "Sync started. Check /api/sync/logs for status." });

    const User     = require("../models/User");
    const lastUser = await User.findOne().sort({ lastLoginAt: -1 }).lean();
    if (lastUser) {
      const { runFullSync } = require("../services/syncService");
      runFullSync({
        clientId:       lastUser.clientId,
        username:       lastUser.username,
        name:           lastUser.name,
        meroshareToken: lastUser.meroshareToken || null,
        userId:         lastUser._id,
        password:       process.env.MEROSHARE_PASSWORD,
      });
    } else {
      logger.warn("Manual sync: no user found in DB.");
    }
  } catch (e) {
    logger.error(e);
  }
};