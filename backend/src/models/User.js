// src/models/User.js
const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    clientId:    { type: Number, required: true },
    username:    { type: String, required: true, unique: true, index: true },
    password:    { type: String, required: true },  // bcrypt-hashed at rest

    // Stores the live MeroShare JWT captured at login.
    // Used by runPortfolioSync() on browser refresh — never the hashed password.
    // Cleared on logout.
    meroshareToken: { type: String, default: null },

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
