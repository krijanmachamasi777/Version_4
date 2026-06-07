// src/services/syncService.js

const { getModel }  = require("../utils/userCollections");
const logger        = require("../utils/logger");

// ── Helper: upsert many with individual error capture ─────────────────
async function bulkUpsert(Model, filterKeys, docs) {
  let count = 0;
  for (const doc of docs) {
    const filter = {};
    filterKeys.forEach((k) => (filter[k] = doc[k]));
    try {
      await Model.findOneAndUpdate(filter, doc, {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      });
      count++;
    } catch (err) {
      logger.warn(`⚠️  Upsert skipped for ${JSON.stringify(filter)}: ${err.message}`);
    }
  }
  return count;
}

// ── Step runners ──────────────────────────────────────────────────────

async function syncProfile(client, username) {
  const UserProfile = getModel(username, "userprofiles"); // → "Krijan.userprofiles"
  const d   = await client.getOwnDetails();
  const now = new Date();

  await UserProfile.findOneAndUpdate(
    { username: d.username || String(client.clientCode) },
    {
      username:        d.username || String(client.clientCode),
      name:            d.name,
      boid:            d.demat,
      clientCode:      String(d.clientCode),
      email:           d.email,
      mobileNumber:    d.mobileNumber,
      dematExpiryDate: d.dematExpiryDate,
      dpName:          d.dpName,
      gender:          d.gender,
      address:         d.address,
      lastSyncedAt:    now,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  logger.info(`  ✔ Profile synced for ${d.name} (BOID: ${d.demat})`);
  return 1;
}

async function syncShares(client, username) {
  const Share          = getModel(username, "shares"); // → "Krijan.shares"
  const { shares }     = await client.getMyShares();
  const now            = new Date();

  const docs = shares.map((s) => ({
    boid:           client.boid,
    script:         s.script,
    scriptDesc:     s.scriptDesc,
    isin:           s.isin,
    currentBalance: s.currentBalance,
    freeBalance:    s.freeBalance,
    freezeBalance:  s.freezeBalance,
    pledgeBalance:  s.pledgeBalance,
    lastSyncedAt:   now,
  }));

  const count = await bulkUpsert(Share, ["boid", "script"], docs);
  logger.info(`  ✔ Shares synced: ${count} records.`);
  return count;
}

async function syncPortfolio(client, username) {
  const PortfolioItem    = getModel(username, "portfolioitems");    // → "Krijan.portfolioitems"
  const PortfolioSummary = getModel(username, "portfoliosummaries"); // → "Krijan.portfoliosummaries"
  const { summary, items } = await client.getPortfolio();
  const now = new Date();

  await PortfolioSummary.findOneAndUpdate(
    { boid: client.boid },
    { boid: client.boid, ...summary, lastSyncedAt: now },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const docs = items.map((item) => ({
    boid:                  client.boid,
    script:                item.script || item.scrip,
    scriptDesc:            item.scriptDesc,
    currentBalance:        item.currentBalance,
    lastTransactionPrice:  item.lastTransactionPrice,
    previousClosingPrice:  item.previousClosingPrice,
    valueOfLastTransPrice: item.valueOfLastTransPrice,
    lastSyncedAt:          now,
  }));

  const count = await bulkUpsert(PortfolioItem, ["boid", "script"], docs);
  logger.info(`  ✔ Portfolio synced: ${count} items + summary.`);
  return count + 1;
}

async function syncApplicableIssues(client, username) {
  const ApplicableIssue = getModel(username, "applicableissues"); // → "Krijan.applicableissues"
  const { issues }      = await client.getApplicableIssues();
  const now             = new Date();

  const docs = issues.map((iss) => ({
    companyShareId: iss.companyShareId,
    scrip:          iss.scrip || iss.script,
    companyName:    iss.companyName || iss.name,
    shareTypeName:  iss.shareTypeName || iss.issueType,
    shareGroupName: iss.shareGroupName,
    issueOpenDate:  iss.issueOpenDate,
    issueCloseDate: iss.issueCloseDate,
    subGroup:       iss.subGroup,
    statusName:     iss.statusName,
    lastSyncedAt:   now,
  }));

  const count = await bulkUpsert(ApplicableIssue, ["companyShareId"], docs);
  logger.info(`  ✔ Applicable issues synced: ${count} records.`);
  return count;
}

async function syncWacc(client, username, scripts = []) {
  const Wacc    = getModel(username, "waccs"); // → "Krijan.waccs"
  const records = await client.getWaccForAll(scripts);
  const now     = new Date();

  const docs = records.map((r) => ({
    boid:                client.boid,
    scrip:               r.scrip,
    isin:                r.isin,
    transactionQuantity: r.transactionQuantity,
    rate:                r.rate,
    purchaseSource:      r.purchaseSource,
    transactionDate:     r.transactionDate ? new Date(r.transactionDate) : null,
    lastSyncedAt:        now,
  }));

  const count = await bulkUpsert(
    Wacc,
    ["boid", "scrip", "transactionDate", "purchaseSource"],
    docs
  );
  logger.info(`  ✔ WACC synced: ${count} records.`);
  return count;
}

// ── Main sync orchestrator ────────────────────────────────────────────

async function runFullSync(credentials = null) {
  const MeroShareClient = require("./meroshareClient");
  const startedAt = new Date();
  const steps     = [];

  logger.info("═══════════════════════════════════════════");
  logger.info("        Starting Full MeroShare Sync       ");
  logger.info("═══════════════════════════════════════════");

  let client;
let username;

if (credentials?.client) {
  client   = credentials.client;
  username = credentials.name || credentials.username;
  } else {
    if (!credentials) {
      // Cron job — no credentials, load last user from DB
      const User    = require("../models/User");
      const lastUser = await User.findOne().sort({ lastLoginAt: -1 }).lean();
      if (!lastUser) {
        logger.error("No user in DB. Login via the app first to enable scheduled sync.");
        return;
      }
     credentials = {
  clientId: lastUser.clientId,
  username: lastUser.username,
  name:     lastUser.name,          // ← add this
  password: process.env.MEROSHARE_PASSWORD,
};
    }

    username = credentials.username;
    logger.info(`Syncing for user: ${username}`);

    // Fresh credentials — do a new login
    client = new MeroShareClient(credentials);
    try {
      await client.login();
      await client.getOwnDetails();
    } catch (err) {
      logger.error("Fatal: login/init failed. Aborting sync.", err);
      // Log failure into the user's own synclogs collection
      const SyncLog = getModel(username, "synclogs");
      await SyncLog.create({
        status:     "failed",
        steps:      [{ name: "login", status: "error", error: err.message }],
        startedAt,
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt,
      });
      return;
    }
  }

  const run = async (name, fn) => {
    try {
      const count = await fn();
      steps.push({ name, status: "ok", recordsUpserted: count });
    } catch (err) {
      logger.error(`  ✖ Step [${name}] failed: ${err.message}`);
      steps.push({ name, status: "error", error: err.message });
    }
  };

  await run("profile",          () => syncProfile(client, username));
  await run("shares",           () => syncShares(client, username));
  await run("portfolio",        () => syncPortfolio(client, username));
  await run("applicableIssues", () => syncApplicableIssues(client, username));

  let scripts = [];
  try {
    const { shares } = await client.getMyShares();
    scripts = shares.map((s) => s.script).filter(Boolean);
  } catch (_) {}

  await run("wacc", () => syncWacc(client, username, scripts));

  const finishedAt = new Date();
  const durationMs = finishedAt - startedAt;
  const hasErrors  = steps.some((s) => s.status === "error");
  const allFailed  = steps.every((s) => s.status === "error");

  // Write sync log into user's own collection → "Krijan.synclogs"
  const SyncLog = getModel(username, "synclogs");
  await SyncLog.create({
    boid:       client.boid,
    status:     allFailed ? "failed" : hasErrors ? "partial" : "success",
    steps,
    startedAt,
    finishedAt,
    durationMs,
  });

  logger.info(`═══════════════════════════════════════════`);
  logger.info(`  Sync complete in ${durationMs}ms. Status: ${allFailed ? "FAILED" : hasErrors ? "PARTIAL" : "SUCCESS"}`);
  logger.info(`═══════════════════════════════════════════`);

  return { steps, durationMs };
}

module.exports = { runFullSync };