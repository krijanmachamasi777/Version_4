// src/utils/userStorage.js
const fs   = require("fs");
const path = require("path");

const USER_DATA_ROOT = path.join(__dirname, "../../userdata"); // stores all users

const USER_FOLDERS = [
  "applicableissues",
  "portfolioitems",
  "portfoliosummaries",
  "shares",
    "userprofiles",
  "waccs",
];

/**
 * Creates the folder structure for a user if it doesn't already exist.
 * Uses the user's MongoDB _id (or username) as the folder name.
 */
function ensureUserFolders(userId) {
  const userRoot = path.join(USER_DATA_ROOT, String(userId));

  for (const folder of USER_FOLDERS) {
    const fullPath = path.join(userRoot, folder);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  return userRoot; // return path in case you need it
}

module.exports = { ensureUserFolders };