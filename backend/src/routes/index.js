// src/routes/index.js
const router           = require("express").Router();
const ctrl             = require("../controllers/index");
const authCtrl         = require("../controllers/authController");
const notificationCtrl = require("../controllers/notificationController");
const journalCtrl      = require("../controllers/journalController");
const watchlistCtrl    = require("../controllers/watchlistController");
const protect          = require("../middleware/auth");

router.get("/health", (req, res) =>
  res.json({ status: "ok", timestamp: new Date().toISOString() })
);

// ── Public routes (no JWT required) ──────────────────────────────────
router.post("/auth/login", authCtrl.login);

// ── Protected routes (JWT required) ──────────────────────────────────
router.use(protect);

router.get("/auth/me",             authCtrl.getMe);
router.post("/auth/logout",        authCtrl.logout);

router.get("/profile",             ctrl.getProfile);
router.post("/notifications/send-email", notificationCtrl.sendNotificationEmail);

router.get("/shares",              ctrl.getShares);
router.get("/shares/:script",      ctrl.getShareByScript);

router.get("/portfolio",           ctrl.getPortfolio);

// Portfolio refresh (browser reload — uses stored MeroShare token)
// If MeroShare session expired → returns 401 { sessionExpired: true }
// Frontend must redirect to login on receiving this.
router.post("/portfolio/refresh",  ctrl.refreshPortfolio);

router.get("/issues",              ctrl.getApplicableIssues);
router.get("/wacc",                ctrl.getWacc);

router.get("/journal-trades",      journalCtrl.getJournalTrades);
router.post("/journal-trades",     journalCtrl.createJournalTrade);
router.put("/journal-trades/:id",  journalCtrl.updateJournalTrade);
router.delete("/journal-trades/:id", journalCtrl.deleteJournalTrade);

router.get("/investment-trades",   journalCtrl.getInvestmentTrades);
router.post("/investment-trades",  journalCtrl.createInvestmentTrade);
router.put("/investment-trades/:id", journalCtrl.updateInvestmentTrade);
router.delete("/investment-trades/:id", journalCtrl.deleteInvestmentTrade);

router.get("/sync/logs",           ctrl.getSyncLogs);

router.get("/watchlist-items",           watchlistCtrl.getWatchlistItems);
router.post("/watchlist-items",          watchlistCtrl.createWatchlistItem);
router.put("/watchlist-items/:id",       watchlistCtrl.updateWatchlistItem);
router.delete("/watchlist-items/:id",    watchlistCtrl.deleteWatchlistItem);

module.exports = router;
