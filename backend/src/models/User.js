// src/models/User.js
const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    clientId:    { type: Number, required: true },
    username:    { type: String, required: true, unique: true, index: true },
    password:    { type: String, required: true },  // bcrypt-hashed at rest

    // ── New sync-control fields ─────────────────────────────────────
    // Stores the YYYY-MM-DD date of the last full sync.
    // Used to skip re-syncing when the user logs in on the same day.
    lastSyncDate: { type: String, default: null },   // "2025-06-08"

    // Stores the live MeroShare JWT so refresh-sync never needs the
    // bcrypt-hashed password.  Cleared on logout.
    meroshareToken: { type: String, default: null },
    // ───────────────────────────────────────────────────────────────

    boid:        { type: String },
    name:        { type: String },
    email:       { type: String },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

// Encrypt password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Compare plain password against stored hash
userSchema.methods.comparePassword = async function (plain) {
  return bcrypt.compare(plain, this.password);
};

module.exports = mongoose.model("User", userSchema);