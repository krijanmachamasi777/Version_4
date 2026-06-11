// src/api/meroshare.js
import { apiFetch } from "./client";

export const getProfile   = (token)         => apiFetch("/profile",   token);
export const getShares    = (token)         => apiFetch("/shares",     token);
export const getPortfolio = (token)         => apiFetch("/portfolio",  token);
export const getIssues    = (token, type)   =>
  apiFetch(`/issues${type ? `?type=${type}` : ""}`, token);
export const getWacc      = (token, script) =>
  apiFetch(`/wacc${script ? `?script=${script}` : ""}`, token);
export const getSyncLogs  = (token)         => apiFetch("/sync/logs", token);

// Portfolio refresh (browser reload — updates LTP / current values from MeroShare)
// If MeroShare session expired, apiFetch dispatches "meroshare:sessionExpired"
// and AuthContext automatically logs the user out and redirects to login.
export const refreshPortfolio = (token) =>
  apiFetch("/portfolio/refresh", token, { method: "POST" });

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
