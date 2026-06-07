// src/api/meroshare.js
//
// CHANGES FROM ORIGINAL:
//   • Added `getShares` export (was missing — needed by AuthContext
//     fetchAllPortfolioData to populate the shares cache).
//   • All other exports are unchanged.
//
import { apiFetch } from "./client";

export const getProfile   = (token)         => apiFetch("/profile",   token);
export const getShares    = (token)         => apiFetch("/shares",     token);   // ← NEW
export const getPortfolio = (token)         => apiFetch("/portfolio",  token);
export const getIssues    = (token, type)   =>
  apiFetch(`/issues${type ? `?type=${type}` : ""}`, token);
export const getWacc      = (token, script) =>
  apiFetch(`/wacc${script ? `?script=${script}` : ""}`, token);
export const triggerSync  = (token)         =>
  apiFetch("/sync", token, { method: "POST" });
export const getSyncLogs  = (token)         => apiFetch("/sync/logs", token);
export const sendNotificationEmail = (token, payload) =>
  apiFetch("/notifications/send-email", token, {
    method: "POST",
    body: JSON.stringify(payload),
  });

// ── Journal trades ─────────────────────────────────────────────────────
export const getJournalTrades = (token) =>
  apiFetch("/journal-trades", token);

export const createJournalTrade = (token, payload) =>
  apiFetch("/journal-trades", token, { method: "POST", body: JSON.stringify(payload) });

export const updateJournalTrade = (token, id, payload) =>
  apiFetch(`/journal-trades/${id}`, token, { method: "PUT", body: JSON.stringify(payload) });

export const deleteJournalTrade = (token, id) =>
  apiFetch(`/journal-trades/${id}`, token, { method: "DELETE" });

// ── Investment trades ──────────────────────────────────────────────────
export const getInvestmentTrades = (token) =>
  apiFetch("/investment-trades", token);

export const createInvestmentTrade = (token, payload) =>
  apiFetch("/investment-trades", token, { method: "POST", body: JSON.stringify(payload) });

export const updateInvestmentTrade = (token, id, payload) =>
  apiFetch(`/investment-trades/${id}`, token, { method: "PUT", body: JSON.stringify(payload) });

export const deleteInvestmentTrade = (token, id) =>
  apiFetch(`/investment-trades/${id}`, token, { method: "DELETE" });