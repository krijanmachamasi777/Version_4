// src/api/client.js
// ─────────────────────────────────────────────────────────────
// Central HTTP utility.
// • Sends Authorization: Bearer <token>  (matches backend middleware/auth.js)
// • Unwraps { success, data } envelope returned by all backend routes
// • Throws on HTTP or logical errors so callers only see clean data
// ─────────────────────────────────────────────────────────────

const BASE = "/api";

/**
 * @param {string}  path   – e.g. "/auth/login", "/portfolio"
 * @param {string|null} token – JWT from sessionStorage
 * @param {RequestInit} opts  – extra fetch options (method, body, …)
 * @returns {Promise<any>}   – the unwrapped `data` field
 */
export async function apiFetch(path, token = null, opts = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers || {}),
  };

  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  const json = await res.json();

  if (!res.ok || json.success === false) {
    throw new Error(json.message || `API error ${res.status}`);
  }

  // Backend always wraps payload in { success: true, data: ... }
  return json.data !== undefined ? json.data : json;
}
