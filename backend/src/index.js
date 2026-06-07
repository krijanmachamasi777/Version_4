// src/index.js — App entry point
require("dotenv").config();

const cron = require("node-cron");
const app = require("./app");
const { connect, disconnect } = require("./config/database");
const { runFullSync } = require("./services/syncService");
const logger = require("./utils/logger");

const PORT = process.env.PORT || 5000;
const SYNC_CRON = process.env.SYNC_CRON || "0 6 * * *";

async function listenOnPort(port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => resolve(server));
    server.on("error", reject);
  });
}

async function start() {
  // 1. Connect to MongoDB — server will NOT start if DB is unavailable
  //    (for a financial app, we want to fail loudly, not silently)
  try {
    await connect();
  } catch (err) {
    logger.error("❌ Cannot start server without a database connection. Fix MONGO_URI in your .env file.");
    process.exit(1); // Stop the app completely — do not run without DB
  }

  // 2. Start Express server
  let currentPort = Number(PORT) || 5000;
  let server;
  const maxPort = currentPort + 10;

  while (!server) {
    try {
      server = await listenOnPort(currentPort);
    } catch (err) {
      if (err.code !== "EADDRINUSE") {
        throw err;
      }
      logger.warn(`⚠️ Port ${currentPort} is already in use. Trying port ${currentPort + 1}...`);
      currentPort += 1;
      if (currentPort > maxPort) {
        logger.error(`❌ All ports from ${PORT} to ${maxPort} are in use. Cannot start server.`);
        process.exit(1);
      }
    }
  }

  logger.info(`🚀 Server running on http://localhost:${currentPort}`);
  logger.info(`📡 API base: http://localhost:${currentPort}/api`);

  // 3. Schedule automatic data sync (default: every day at 6 AM)
  if (cron.validate(SYNC_CRON)) {
    cron.schedule(SYNC_CRON, async () => {
      logger.info(`⏰ Scheduled sync triggered (cron: ${SYNC_CRON})`);
      await runFullSync();
    });
    logger.info(`📅 Sync scheduled: ${SYNC_CRON}`);
  } else {
    logger.warn(`⚠️  Invalid SYNC_CRON expression: "${SYNC_CRON}". Scheduler disabled.`);
  }

  // 4. Graceful shutdown — cleanly closes DB connection on Ctrl+C or server stop
  const shutdown = async (signal) => {
    logger.info(`\n${signal} received. Shutting down gracefully...`);
    server.close(async () => {
      await disconnect();
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
}

start().catch((err) => {
  logger.error("Fatal startup error:", err);
  process.exit(1);
});