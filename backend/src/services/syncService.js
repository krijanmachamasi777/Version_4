// src/services/syncService.js
//
// BEHAVIOR:
//   runFullSync()     — Full sync every login. Fetches all MeroShare data
//                       and upserts into MongoDB. Never skips based on date.
//   runPortfolioSync() — Lightweight refresh using stored MeroShare token.
//                        Called on browser refresh. Only updates portfolio.
//                        If token expired → throws "sessionExpired" error.
//
// IMPORTANT: Hashed passwords are NEVER used for MeroShare re-authentication.
//            Only the stored meroshareToken (captured at login) is reused.
//

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

// ── Build / restore a MeroShareClient ────────────────────────────────
//
// Priority:
//   1. credentials.client — already-authenticated client (from login flow)
//   2. credentials.meroshareToken — restore session from stored token
//   3. Fresh login (should only happen in rare fallback cases)
//
// CRITICAL: hashed passwords must never be sent to MeroShare.
// Only plain passwords (during initial login) or stored tokens are used.
//
async function _buildClient(credentials) {
  const MeroShareClient = require("./meroshareClient");

  // Already-authenticated client — use it directly
  if (credentials?.client) {
    return credentials.client;
  }

  const client = new MeroShareClient({
    clientId: credentials.clientId,
    username: credentials.username,
    password: credentials.password,  // only used when token is absent
  });

  if (credentials.meroshareToken) {
    // Restore session from stored token — no password needed
    client.token = credentials.meroshareToken;
    try {
      await client.getOwnDetails();
      logger.info("🔑 MeroShare session restored from stored token.");
    } catch (err) {
      // Token expired or invalid
      logger.warn("⚠️  Stored MeroShare token is expired or invalid.");
      const sessionErr = new Error("MeroShare session expired. Please login again.");
      sessionErr.sessionExpired = true;
      throw sessionErr;
    }
  } else {
    // Fresh login
    await client.login();
    await client.getOwnDetails();
  }

  return client;
}

// ── Step runners ──────────────────────────────────────────────────────

async function syncProfile(client, username) {
  const UserProfile = getModel(username, "userprofiles");
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
  const Share      = getModel(username, "shares");
  const { shares } = await client.getMyShares();
  const now        = new Date();

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
  const PortfolioItem    = getModel(username, "portfolioitems");
  const PortfolioSummary = getModel(username, "portfoliosummaries");
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
  const ApplicableIssue = getModel(username, "applicableissues");
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
  const Wacc    = getModel(username, "waccs");
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

// ── Full sync orchestrator ────────────────────────────────────────────
//
// Runs on EVERY login — no date checks, no skipping.
//
// credentials: {
//   client?:        MeroShareClient   (already authenticated from login)
//   clientId?:      number
//   username?:      string
//   name?:          string            (display name / folder key)
//   password?:      string            (plain — only used for initial login)
//   meroshareToken?: string           (stored token — avoids fresh login)
//   userId?:        ObjectId          (to update User.meroshareToken after sync)
// }
//
async function runFullSync(credentials = null) {
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
      // Fallback: no credentials — load last user from DB (cron use case)
      const User     = require("../models/User");
      const lastUser = await User.findOne().sort({ lastLoginAt: -1 }).lean();
      if (!lastUser) {
        logger.error("No user in DB. Login via the app first to enable scheduled sync.");
        return;
      }
      credentials = {
        clientId:       lastUser.clientId,
        username:       lastUser.username,
        name:           lastUser.name,
        meroshareToken: lastUser.meroshareToken || null,
        password:       process.env.MEROSHARE_PASSWORD,
        userId:         lastUser._id,
      };
    }

    username = credentials.name || credentials.username;
    logger.info(`Syncing for user: ${username}`);

    try {
      client = await _buildClient(credentials);
    } catch (buildErr) {
      logger.error("Fatal: login/init failed. Aborting sync.", buildErr);
      const SyncLog = getModel(username, "synclogs");
      await SyncLog.create({
        status:     "failed",
        steps:      [{ name: "login", status: "error", error: buildErr.message }],
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

  // Persist the refreshed MeroShare token for subsequent portfolio refreshes
  if (credentials?.userId) {
    try {
      const User = require("../models/User");
      await User.findByIdAndUpdate(credentials.userId, {
        meroshareToken: client.token || null,
      });
      logger.info("  ✔ MeroShare token saved to User.");
    } catch (e) {
      logger.warn("⚠️  Could not update meroshareToken on User:", e.message);
    }
  }

  // Write sync log
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

// ── Portfolio-only refresh sync ───────────────────────────────────────
//
// Called on browser refresh (not login). Updates ONLY portfolioitems and
// portfoliosummaries (LTP / current values). Uses stored meroshareToken.
// NEVER uses hashed passwords.
//
// If token expired → throws error with sessionExpired = true.
//   → Backend returns 401 { sessionExpired: true }
//   → Frontend clears session + redirects to login.
//
async function runPortfolioSync(credentials) {
  const { userId, name: username } = credentials;

  if (!userId)   throw new Error("runPortfolioSync: userId is required.");
  if (!username) throw new Error("runPortfolioSync: name (username) is required.");

  logger.info(`🔄 Portfolio refresh sync for: ${username}`);

  const User    = require("../models/User");
  const userDoc = await User.findById(userId).select("meroshareToken clientId").lean();

  if (!userDoc?.meroshareToken) {
    const e = new Error("MeroShare session expired. Please login again.");
    e.sessionExpired = true;
    throw e;
  }

  let client;
  try {
    client = await _buildClient({
      clientId:       userDoc.clientId,
      meroshareToken: userDoc.meroshareToken,
    });
  } catch (err) {
    const e = new Error("MeroShare session expired. Please login again.");
    e.sessionExpired = true;
    throw e;
  }

  const startedAt = new Date();
  let count;
  try {
    count = await syncPortfolio(client, username);
  } catch (err) {
    logger.error(`  ✖ Portfolio refresh failed: ${err.message}`);
    throw err;
  }

  // Persist refreshed token in case MeroShare rotated it
  await User.findByIdAndUpdate(userId, {
    meroshareToken: client.token || userDoc.meroshareToken,
  });

  const durationMs = Date.now() - startedAt;
  logger.info(`  ✔ Portfolio refresh complete in ${durationMs}ms (${count} records).`);

  return { count, durationMs };
}

module.exports = { runFullSync, runPortfolioSync };
