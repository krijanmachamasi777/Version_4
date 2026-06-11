// src/schemas/investmentEntrySchema.js
//
// CHANGES:
//   • Added `waccId` field — links an imported (MeroShare/WACC-sourced) entry
//     back to its source WACC record. Used to detect duplicates on every load
//     so we never create the same entry twice. Empty string for manual trades.
//   • Added index on waccId for fast duplicate lookups.
//   • Added compound index on (scrip, boughtDate) — already existed, kept.
//
const mongoose = require("mongoose");

const investmentEntrySchema = new mongoose.Schema({
  scrip:          { type: String, required: true, index: true },
  sector:         { type: String, default: "" },
  qty:            { type: Number, default: 0 },
  buyRate:        { type: Number, default: 0 },
  soldRate:       { type: Number, default: null },
  buyAmt:         { type: Number, default: 0 },
  soldAmt:        { type: Number, default: null },
  ltp:            { type: Number, default: 0 },
  valueAsOfLtp:   { type: Number, default: 0 },
  boughtDate:     { type: String, default: "" },
  soldDate:       { type: String, default: null },
  remarks:        { type: String, default: "" },
  imported:       { type: Boolean, default: false },
  origin:         { type: String, default: "manual" },
  // waccId links an imported entry back to its WACC source record.
  // Used to detect duplicates so we never create the same entry twice.
  // Empty string for all manual trades.
  waccId:         { type: String, default: "", index: true },
}, { timestamps: true });

investmentEntrySchema.index({ scrip: 1, boughtDate: 1 });

module.exports = { investmentEntrySchema };