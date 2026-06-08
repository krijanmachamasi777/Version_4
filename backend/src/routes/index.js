// src/routes/index.js
const router           = require("express").Router();
const ctrl             = require("../controllers/index");
const authCtrl         = require("../controllers/authController");
const notificationCtrl = require("../controllers/notificationController");
const journalCtrl      = require("../controllers/journalController");
const protect          = require("../middleware/auth");

router.get("/health", (req, res) =>
  res.json({ status: "ok", timestamp: new Date().toISOString() })
);
router.post("/auth/login", authCtrl.login);

router.use(protect);

router.get("/auth/me",        authCtrl.getMe);
router.get("/profile",        ctrl.getProfile);
router.post("/notifications/send-email", notificationCtrl.sendNotificationEmail);
router.get("/shares",         ctrl.getShares);
router.get("/shares/:script", ctrl.getShareByScript);
router.get("/portfolio",      ctrl.getPortfolio);
router.get("/issues",         ctrl.getApplicableIssues);
router.get("/wacc",           ctrl.getWacc);
router.get("/journal-trades", journalCtrl.getJournalTrades);
router.post("/journal-trades", journalCtrl.createJournalTrade);
router.put("/journal-trades/:id", journalCtrl.updateJournalTrade);
router.delete("/journal-trades/:id", journalCtrl.deleteJournalTrade);
router.get("/investment-trades", journalCtrl.getInvestmentTrades);
router.post("/investment-trades", journalCtrl.createInvestmentTrade);
router.put("/investment-trades/:id", journalCtrl.updateInvestmentTrade);
router.delete("/investment-trades/:id", journalCtrl.deleteInvestmentTrade);
router.get("/sync/logs",      ctrl.getSyncLogs);

// ── Portfolio refresh (called on browser refresh) ──────────────────
// Fetches live portfolio + LTP data from MeroShare and updates MongoDB.
// Does NOT perform a full sync. Uses the stored MeroShare token —
// never the hashed password.
router.post("/portfolio/refresh", ctrl.refreshPortfolio);

module.exports = router;