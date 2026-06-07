// src/controllers/authController.js
//
// CHANGES FROM ORIGINAL:
//   • On first login (new user), runFullSync() is now AWAITED before the
//     response is sent, so the frontend always receives DB-backed data.
//   • On subsequent logins the sync still runs in the background (non-blocking).
//   • Response now includes `firstLogin: true/false` so the frontend can show
//     a one-time "data loaded" indicator.
//
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const MeroShareClient = require("../services/meroshareClient");
const { runFullSync } = require("../services/syncService");
const logger = require("../utils/logger");
const { ensureUserCollections } = require("../utils/userCollections");

const ok  = (res, data, meta = {}) => res.json({ success: true, ...meta, data });
const err = (res, message, status = 400) =>
  res.status(status).json({ success: false, message });

function generateToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

const DP_CODE_TO_ID = {
  19000: 1287, 20600: 1315, 13200: 128,  12300: 129,  17200: 130,
  22300: 2155, 21800: 2136, 11900: 131,  17500: 201,  14700: 133,
  23200: 2170, 19100: 1298, 15000: 135,  20700: 1314, 15600: 132,
  20900: 1318, 19500: 1292, 11700: 137,  13300: 139,  13400: 140,
  12000: 141,  14500: 142,  11300: 143,  14900: 144,  20300: 1311,
  19800: 1305, 10800: 145,  17600: 153,  21900: 2137, 11100: 134,
  12200: 151,  11200: 146,  16200: 147,  18000: 681,  20500: 1317,
  22900: 2164, 19600: 1297, 10100: 138,  17700: 148,  22800: 2162,
  17400: 149,  13100: 150,  20000: 1308, 20800: 1316, 19900: 1306,
  23100: 2167, 23300: 2169, 17900: 402,  22000: 2140, 20100: 1309,
  18700: 1271, 18200: 1182, 14300: 154,  15200: 156,  16300: 168,
  12400: 195,  10700: 157,  13800: 158,  16100: 159,  14100: 155,
  21400: 1327, 22200: 2156, 16700: 160,  18900: 1281, 13600: 161,
  21600: 1329, 19700: 1295, 21100: 1325, 12500: 199,  15900: 163,
  16800: 198,  15100: 166,  10400: 164,  20400: 1320, 23400: 2171,
  15700: 167,  15500: 169,  23500: 2182, 16400: 165,  15300: 170,
  11500: 171,  13700: 174,  10600: 173,  10200: 172,  17300: 162,
  11000: 175,  11800: 176,  21200: 1324, 17000: 177,  21300: 1328,
  13900: 178,  16000: 136,  12600: 179,  22600: 2161, 14800: 180,
  15400: 152,  16900: 181,  12800: 182,  18600: 1270, 19400: 1293,
  16600: 183,  23000: 2165, 16500: 184,  22100: 2142, 21500: 1326,
  21700: 2134, 18100: 1080, 14400: 185,  15800: 186,  22400: 2157,
  11600: 187,  12700: 188,  18400: 1189, 19200: 1294, 18500: 1196,
  18800: 1274, 12900: 189,  20200: 1310, 10900: 190,  14600: 191,
  13000: 192,  14000: 193,  21000: 1319, 14200: 194,  19300: 1296,
  17800: 370,  22500: 2158, 18300: 1186, 22700: 2163, 11400: 196,
  17100: 197,  13500: 200,
};

// POST /api/auth/login
exports.login = async (req, res) => {
  const { dpCode, username, password } = req.body;

  if (!dpCode || !username || !password) {
    return err(res, "dpCode, username and password are required.");
  }

  const clientId = DP_CODE_TO_ID[String(dpCode)];
  if (!clientId) {
    return err(res, `Unknown DP code: ${dpCode}.`, 400);
  }

  let client;
  let userId;
  let userName;
  let isFirstLogin = false;

  try {
    client = new MeroShareClient({ clientId, username, password });
    await client.login();
    const profile = await client.getOwnDetails();

    let user = await User.findOne({ username });
    if (user) {
      // Returning user — update credentials
      user.clientId    = clientId;
      user.password    = password;
      user.boid        = profile.demat;
      user.name        = profile.name;
      user.email       = profile.email;
      user.lastLoginAt = new Date();
      await user.save();
    } else {
      // Brand-new user
      isFirstLogin = true;
      user = await User.create({
        clientId,
        username,
        password,
        boid:        profile.demat,
        name:        profile.name,
        email:       profile.email,
        lastLoginAt: new Date(),
      });
    }

    userId   = user._id;
    userName = user.name;

    await ensureUserCollections(userName);
    logger.info(`📁 DB collections ready for: ${userName}`);

    const token = generateToken(userId);
    logger.info(`✅ User logged in: ${username} (${profile.name})`);

    // ─────────────────────────────────────────────────────────────────
    // FIRST-TIME LOGIN → block until sync completes so the frontend
    // receives data from MongoDB on the very first request.
    // ─────────────────────────────────────────────────────────────────
    if (isFirstLogin) {
      logger.info("🔄 First login — running BLOCKING sync...");
      try {
        await runFullSync({ client, clientId, username, password, userId, name: userName });
        logger.info("✅ First-login sync complete.");
      } catch (syncErr) {
        // Sync failed — log it but still let the user in (data will be empty)
        logger.error("❌ First-login sync failed:", syncErr);
      }
    }

    // Always respond AFTER any blocking work is done
    ok(res, {
      token,
      firstLogin: isFirstLogin,
      user: {
        id:       user._id,
        name:     user.name,
        username: user.username,
        email:    user.email,
        boid:     user.boid,
      },
    });

  } catch (e) {
    if (e.response?.status === 401 || e.response?.status === 400) {
      return err(res, "Invalid MeroShare credentials.", 401);
    }
    logger.error(e);
    return err(res, "Login failed. Please try again.", 500);
  }

  // ─────────────────────────────────────────────────────────────────
  // RETURNING LOGIN → background sync (non-blocking, after response)
  // ─────────────────────────────────────────────────────────────────
  if (!isFirstLogin) {
    logger.info("🔄 Background sync started after returning login...");
    runFullSync({ client, clientId, username, password, userId, name: userName })
      .then(() => logger.info("✅ Background sync complete."))
      .catch((e) => logger.error("❌ Background sync failed:", e));
  }
};

// GET /api/auth/me
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password").lean();
    if (!user) return err(res, "User not found.", 404);
    ok(res, user);
  } catch (e) {
    logger.error(e);
    err(res, e.message, 500);
  }
};