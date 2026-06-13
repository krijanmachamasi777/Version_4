// src/utils/userCollections.js
const mongoose = require("mongoose");

const { applicableIssueSchema } = require("../schemas/applicableIssueSchema");
const { shareSchema }           = require("../schemas/shareSchema");
const { portfolioItemSchema, portfolioSummarySchema } = require("../schemas/portfolioSchema");
const { userProfileSchema }     = require("../schemas/userProfileSchema");
const { waccSchema }            = require("../schemas/waccSchema");
const { syncLogSchema }         = require("../schemas/syncLogSchema");
const { journalEntrySchema }    = require("../schemas/journalEntrySchema");
const { investmentEntrySchema } = require("../schemas/investmentEntrySchema");
const { watchlistEntrySchema }  = require("../schemas/watchlistEntrySchema");

const COLLECTION_SCHEMAS = {
  applicableissues:   applicableIssueSchema,
  shares:             shareSchema,
  portfolioitems:     portfolioItemSchema,
  portfoliosummaries: portfolioSummarySchema,
  userprofiles:       userProfileSchema,
  waccs:              waccSchema,
  synclogs:           syncLogSchema,
  journalentries:     journalEntrySchema,
  investmententries:  investmentEntrySchema,
  watchlistentries:   watchlistEntrySchema,
};

const modelCache = {};

/**
 * Returns a Mongoose model for a user-scoped collection.
 * Collection name format: "Krijan.shares" → appears as folder in Compass
 */
function getModel(username, collectionName) {
  // Capitalize first letter to match folder display: "krijan" → "Krijan"
  const folderName = username.charAt(0).toUpperCase() + username.slice(1).toLowerCase();
  const collectionKey = `${folderName}.${collectionName}`; // e.g. "Krijan.shares"
  const cacheKey = collectionKey;

  if (modelCache[cacheKey]) return modelCache[cacheKey];

  const schema = COLLECTION_SCHEMAS[collectionName];
  if (!schema) throw new Error(`Unknown collection: ${collectionName}`);

  // 3rd argument to mongoose.model() is the actual MongoDB collection name
  const model = mongoose.model(cacheKey, schema, collectionKey);
  modelCache[cacheKey] = model;
  return model;
}

/**
 * Creates all collections for a user in MongoDB.
 * MongoDB only physically creates a collection when data is inserted,
 * so we explicitly create them here so they appear immediately in Compass.
 */
async function ensureUserCollections(username) {
  const folderName = username.charAt(0).toUpperCase() + username.slice(1).toLowerCase();
  const db = mongoose.connection.db;

  for (const collectionName of Object.keys(COLLECTION_SCHEMAS)) {
    const collectionKey = `${folderName}.${collectionName}`; 
    const exists = await db.listCollections({ name: collectionKey }).toArray();
    if (exists.length === 0) {
      await db.createCollection(collectionKey);
    }
  }
}

module.exports = { getModel, ensureUserCollections };