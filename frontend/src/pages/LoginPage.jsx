// src/pages/LoginPage.jsx
// ─────────────────────────────────────────────────────────────
// Full-page MeroShare login.
// Collects: DP / Client ID · Username · Password
// Posts to POST /api/auth/login via AuthContext.login()
// ─────────────────────────────────────────────────────────────
//// this is the comment 
import { useState } from "react";
import { useAuth }  from "../context/AuthContext";
import "./LoginPage.css";



export function LoginPage() {
  const { login, loading, error } = useAuth();

  const [dpCode,   setDpCode]   = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);

  const canSubmit = dpCode && username && password && !loading;

  const handleSubmit = async e => {
    e?.preventDefault?.();
    if (!canSubmit) return;
    await login({ dpCode, username, password });
    // On success, isLoggedIn becomes true in AuthContext,
    // and App.jsx will automatically unmount LoginPage and render the main app.
  };

  const handleKeyDown = e => {
    if (e.key === "Enter") handleSubmit();
  };

  return (
    <div className="lp-root">
      {/* Background decoration */}
      <div className="lp-bg">
        <div className="lp-bg__orb lp-bg__orb--1" />
        <div className="lp-bg__orb lp-bg__orb--2" />
        <div className="lp-bg__grid" />
      </div>

      <div className="lp-wrap">
        {/* Brand */}
        <div className="lp-brand">
          <div className="lp-brand__icon">📊</div>
          <div className="lp-brand__name">Kitakat</div>
          <div className="lp-brand__tag">Investment Journal &amp; MeroShare Tracker</div>
        </div>

        {/* Card */}
        <div className="lp-card">
          <div className="lp-card__head">
            <h1 className="lp-card__title">Connect MeroShare</h1>
            <p className="lp-card__sub">
              Enter your CDSC credentials to unlock live portfolio data
            </p>
          </div>

          {error && (
            <div className="lp-alert lp-alert--error">
              <span className="lp-alert__icon">⚠</span>
              <span>{error}</span>
            </div>
          )}

          <div className="lp-fields" onKeyDown={handleKeyDown}>
            {/* DP Code */}
            <div className="lp-field">
              <label className="lp-field__label" htmlFor="dpCode">
                DP Code
              </label>
              <div className="lp-field__input-wrap">
                <span className="lp-field__icon">🏦</span>
                <input
                  id="dpCode"
                  type="text"
                  className="lp-field__input"
                  placeholder="e.g. 15600"
                  value={dpCode}
                  onChange={e => setDpCode(e.target.value)}
                  disabled={loading}
                  autoComplete="off"
                />
              </div>
              <span className="lp-field__hint">Your 5-digit DP (Depository Participant) code</span>
            </div>

            {/* Username */}
            <div className="lp-field">
              <label className="lp-field__label" htmlFor="username">
                Username
              </label>
              <div className="lp-field__input-wrap">
                <span className="lp-field__icon">👤</span>
                <input
                  id="username"
                  type="text"
                  className="lp-field__input"
                  placeholder="MeroShare username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  disabled={loading}
                  autoComplete="username"
                />
              </div>
            </div>

            {/* Password */}
            <div className="lp-field">
              <label className="lp-field__label" htmlFor="password">
                Password
              </label>
              <div className="lp-field__input-wrap">
                <span className="lp-field__icon">🔑</span>
                <input
                  id="password"
                  type={showPass ? "text" : "password"}
                  className="lp-field__input lp-field__input--pass"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={loading}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="lp-field__eye"
                  onClick={() => setShowPass(p => !p)}
                  tabIndex={-1}
                  aria-label={showPass ? "Hide password" : "Show password"}
                >
                  {showPass ? "🙈" : "👁"}
                </button>
              </div>
            </div>
          </div>

          <button
            className="lp-submit"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {loading ? (
              <>
                <span className="lp-spinner" />
                Authenticating…
              </>
            ) : (
              <>
                <span>Connect to MeroShare</span>
                <span className="lp-submit__arrow">→</span>
              </>
            )}
          </button>

          <div className="lp-security">
            <span className="lp-security__icon">🔒</span>
            <span>
              Credentials are verified directly with cdsc.com.np.
              Your password is never stored in plain text.
            </span>
          </div>
        </div>

        <p className="lp-footer">
          Sign in with your CDSC credentials to access your investment dashboard,
          journal, and live MeroShare data.
        </p>
      </div>
    </div>
  );
}