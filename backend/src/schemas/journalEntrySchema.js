const mongoose = require("mongoose");

const journalEntrySchema = new mongoose.Schema({
  tsn:            { type: String, index: true },
  scrip:          { type: String, required: true, index: true },
  qty:            { type: Number, default: 0 },
  buyRate:        { type: Number, default: 0 },
  sellRate:       { type: Number, default: 0 },
  buyAmt:         { type: Number, default: 0 },
  soldAmt:        { type: Number, default: 0 },
  ltp:            { type: Number, default: 0 },
  valueAsOfLtp:   { type: Number, default: 0 },
  boughtDate:     { type: String, default: "" },
  soldDate:       { type: String, default: "" },
  rr:             { type: String, default: "—" },
  remarks:        { type: String, default: "" },
  imported:       { type: Boolean, default: false },
  origin:         { type: String, default: "manual" },
  // waccId links an imported entry back to its WACC source record.
  // Used to detect duplicates so we never create the same entry twice.
  // Empty string for all manual trades.
  waccId:         { type: String, default: "", index: true },
}, { timestamps: true });

journalEntrySchema.index({ scrip: 1, boughtDate: 1 });

module.exports = { journalEntrySchema };