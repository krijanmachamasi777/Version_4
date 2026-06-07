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
}, { timestamps: true });

investmentEntrySchema.index({ scrip: 1, boughtDate: 1 });

module.exports = { investmentEntrySchema };