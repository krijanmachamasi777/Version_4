// src/services/meroshareClient.js
const axios = require("axios");
const {
  AUTH_URL,
  VIEW_URL,
  PURCHASE_URL,
  CREDENTIALS,
  DEFAULTS,
} = require("../config/meroshare");
const logger = require("../utils/logger");

class MeroShareClient {
  constructor(credentials = {}) {
    this.credentials = {
      clientId: credentials.clientId || CREDENTIALS.clientId,
      username: credentials.username || CREDENTIALS.username,
      password: credentials.password || CREDENTIALS.password,
    };
    this.token = null;
    this.boid = null;
    this.clientCode = null;
  }

  // ── Private helpers ─────────────────────────────────────────────────

  _headers() {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: this.token,
    };
  }

  _requireAuth() {
    if (!this.token) {
      throw new Error("Client is not authenticated. Call login() first.");
    }
  }

  _requireBoid() {
    if (!this.boid) {
      throw new Error("BOID not set. Call getOwnDetails() first.");
    }
  }
  // ── Auth ────────────────────────────────────────────────────────────

  async login() {
    logger.debug("Logging in to MeroShare...");
    const res = await axios.post(
      `${AUTH_URL}/auth/`,
      {
        clientId: this.credentials.clientId,
        username: this.credentials.username,
        password: this.credentials.password,
      },
      { headers: { "Content-Type": "application/json" } },
    );

    const token = res.headers["authorization"];
    if (!token)
      throw new Error("Login failed: no authorization token returned.");

    this.token = token;
    logger.info("✅ MeroShare login successful.");
    return token;
  }

  // ── Own Details ─────────────────────────────────────────────────────

  async getOwnDetails() {
    this._requireAuth();
    const res = await axios.get(`${AUTH_URL}/ownDetail/`, {
      headers: this._headers(),
    });
    const d = res.data;

    this.boid = d.demat;
    this.clientCode = d.clientCode;

    logger.debug(`Own details fetched. BOID: ${this.boid}`);
    return d;
  }

  // ── Shares ──────────────────────────────────────────────────────────

  async getMyShares(page = DEFAULTS.PAGE, size = DEFAULTS.SIZE) {
    this._requireAuth();
    const res = await axios.post(
      `${VIEW_URL}/myShare/`,
      {
        sortBy: "CCY_SHORT_NAME",
        demat: [this.boid],
        clientCode: String(this.clientCode),
        page,
        size,
        sortAsc: true,
      },
      { headers: this._headers() },
    );

    const data = res.data;
    const shares = Array.isArray(data) ? data : data?.meroShareDematShare || [];

    logger.debug(`Fetched ${shares.length} shares.`);
    return { shares, total: data?.totalItems ?? shares.length };
  }

  // ── Portfolio ────────────────────────────────────────────────────────

  async getPortfolio(page = DEFAULTS.PAGE, size = DEFAULTS.SIZE) {
    this._requireAuth();
    const res = await axios.post(
      `${VIEW_URL}/myPortfolio/`,
      {
        sortBy: "script",
        demat: [this.boid],
        clientCode: String(this.clientCode),
        page,
        size,
        sortAsc: true,
      },
      { headers: this._headers() },
    );

    const data = res.data;
    const items =
      data.meroShareMyPortfolio || data.myPortfolio || data.object || [];

    logger.debug(`Fetched portfolio with ${items.length} items.`);
    return {
      summary: {
        totalCostPrice: data.totalCostPrice ?? 0,
        totalValueOfLastTransPrice: data.totalValueOfLastTransPrice ?? 0,
      },
      items: Array.isArray(items) ? items : [],
    };
  }

  // ── Applicable Issues (IPO/FPO) ─────────────────────────────────────

  async getApplicableIssues(page = DEFAULTS.PAGE, size = DEFAULTS.SIZE) {
    this._requireAuth();
    const res = await axios.post(
      `${AUTH_URL}/companyShare/applicableIssue/`,
      {
        filterDateParams: [
          { key: "minIssueOpenDate", condition: "", alias: "", value: "" },
          { key: "maxIssueCloseDate", condition: "", alias: "", value: "" },
        ],
        filterFieldParams: [
          { key: "companyIssue.companyISIN.script", alias: "Scrip" },
          {
            key: "companyIssue.companyISIN.company.name",
            alias: "Company Name",
          },
          {
            key: "companyIssue.assignedToClient.name",
            value: "",
            alias: "Issue Manager",
          },
        ],
        page,
        size,
        searchRoleViewConstants: "VIEW_APPLICABLE_SHARE",
      },
      { headers: this._headers() },
    );

    const data = res.data;
    const issues =
      data.object || data.applicableIssue || (Array.isArray(data) ? data : []);
    const total = data.totalCount || data.totalItems || issues.length;

    logger.debug(`Fetched ${issues.length} applicable issues.`);
    return { issues, total };
  }

  // ── WACC ────────────────────────────────────────────────────────────

  async getWaccForScript(script) {
    this._requireAuth();
    const res = await axios.post(
      `${PURCHASE_URL}/search/wacc/`,
      { demat: this.boid, scrip: script },
      { headers: this._headers() },
    );

    const records = res.data?.waccUpdateResponse || [];
    logger.debug(`Fetched ${records.length} WACC records for ${script}.`);
    return records;
  }

  async getWaccForAll(scripts = []) {
    this._requireAuth();
    const all = [];
    for (const script of scripts) {
      try {
        const records = await this.getWaccForScript(script);
        all.push(...records);
      } catch (err) {
        logger.warn(`⚠️  WACC fetch failed for ${script}: ${err.message}`);
      }
    }
    return all;
  }
}

module.exports = MeroShareClient;
