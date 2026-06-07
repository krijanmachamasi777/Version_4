// src/app.js — Express app setup
const express = require("express");
const cors    = require("cors");
const routes  = require("./routes/index");
const { notFound, errorHandler } = require("./middleware/errorHandler");

const app = express();

// ── Allowed frontend origins ─────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(o => o.trim())
  .filter(Boolean);

// Always allow local dev origins
const DEFAULT_ORIGINS = [
  "http://localhost:5173",  // Vite default
  "http://localhost:3000",  // CRA default
  "http://localhost:4173",  // Vite preview
];

const allowedOrigins = [...new Set([...DEFAULT_ORIGINS, ...ALLOWED_ORIGINS])];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. mobile apps, Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: Origin ${origin} not allowed`));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));

app.options("*", cors());

// ── Body parsing ─────────────────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));          // Limit payload size for security
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ── Request logger ───────────────────────────────────────────────────────
app.use((req, _res, next) => {
  const logger = require("./utils/logger");
  logger.debug(`→ ${req.method} ${req.url}`);
  next();
});

// ── Routes ───────────────────────────────────────────────────────────────
app.use("/api", routes);

// ── Error handling ───────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;