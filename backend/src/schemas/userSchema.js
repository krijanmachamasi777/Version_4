// src/schemas/userSchema.js
const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");

const userSchema = new mongoose.Schema({
  clientId:    { type: Number, required: true },
  username:    { type: String, required: true, unique: true, index: true },
  password:    { type: String, required: true },

  // Live MeroShare JWT — stored after login, used by portfolio refresh sync.
  // NEVER the hashed password. Cleared on logout.
  meroshareToken: { type: String, default: null },

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
