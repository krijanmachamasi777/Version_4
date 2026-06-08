// src/schemas/userSchema.js
const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");

const userSchema = new mongoose.Schema({
  clientId:    { type: Number, required: true },
  username:    { type: String, required: true, unique: true, index: true },
  password:    { type: String, required: true },

  // ── Sync-control fields ─────────────────────────────────────────────
  lastSyncDate:   { type: String, default: null },   // "YYYY-MM-DD"
  meroshareToken: { type: String, default: null },   // live MeroShare JWT
  // ───────────────────────────────────────────────────────────────────

  boid:        { type: String },
  name:        { type: String },
  email:       { type: String },
  lastLoginAt: { type: Date },
}, { timestamps: true });

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = async function (plain) {
  return bcrypt.compare(plain, this.password);
};

module.exports = { userSchema };