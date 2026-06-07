// src/api/auth.js
// ─────────────────────────────────────────────────────────────
// Auth-related API calls.
//   POST /api/auth/login  → { token, user }
//   GET  /api/auth/me     → user object
// ─────────────────────────────────────────────────────────────

import { apiFetch } from "./client";

/**
 * Authenticate against MeroShare via our backend.
 * @param {{ dpCode: string, username: string, password: string }} creds
 * @returns {{ token: string, user: object }}
 */
export function loginApi(creds) {
  return apiFetch("/auth/login", null, {
    method: "POST",
    body: JSON.stringify(creds),
  });
}

/**
 * Fetch the authenticated user's own record.
 * @param {string} token
 * @returns {object} user
 */
export function getMeApi(token) {
  return apiFetch("/auth/me", token);
}