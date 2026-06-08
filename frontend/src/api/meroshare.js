// src/api/meroshare.js
//
// CHANGES FROM ORIGINAL:
//   • Added `refreshPortfolio` export — calls POST /portfolio/refresh.
//     Used on every browser refresh to update LTP / current portfolio values.
//     The backend handles session reuse (never sends the hashed password).
//
import { apiFetch } from "./client";

export const getProfile   = (token)         => apiFetch("/profile",   token);
export const getShares    = (token)         => apiFetch("/shares",     token);
export const getPortfolio = (token)         => apiFetch("/portfolio",  token);
export const getIssues    = (token, type)   =>
  apiFetch(`/issues${type ? `?type=${type}` : ""}`, token);
export const getWacc      = (token, script) =>
  apiFetch(`/wacc${script ? `?script=${script}` : ""}`, token);
export const triggerSync  = (token)         =>
  apiFetch("/sync", token, { method: "POST" });
export const getSyncLogs  = (token)         => apiFetch("/sync/logs", token);

// ── Portfolio refresh (browser refresh — LTP / current value update) ──
// Calls MeroShare portfolio APIs on the backend, updates MongoDB,
// and returns the fresh portfolio data from MongoDB.
// The backend uses the stored MeroShare session token (never the hashed password).
// If the session is expired, throws an error with sessionExpired: true.
export const refreshPortfolio = async (token) => {
  const res = await fetch("/api/portfolio/refresh", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  const json = await res.json();

  if (res.status === 401 && json.sessionExpired) {
    const error = new Error(json.message || "MeroShare session expired. Please login again.");
    error.sessionExpired = true;
    throw error;
  }

  if (!res.ok || json.success === false) {
    throw new Error(json.message || `API error ${res.status}`);
  }

  return json.data !== undefined ? json.data : json;
};

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