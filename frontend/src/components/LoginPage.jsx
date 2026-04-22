/**
 * LoginPage.jsx
 *
 * Shown before the app loads if the user is not authenticated.
 * Two options:
 *   1. Username + password
 *   2. Sign in with Google
 *
 * On success, stores the JWT in localStorage and calls onLogin().
 */

import { useState } from "react";

const API = "https://skc-production.up.railway.app";

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // ── Username + Password ──────────────────────────────────────────────────
  async function handleLogin(e) {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "Login failed");
      localStorage.setItem("skc_token", d.access_token);
      localStorage.setItem("skc_user", JSON.stringify({
        username: d.username,
        email: d.email,
        avatar: d.avatar,
      }));
      onLogin(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // ── Google OAuth ─────────────────────────────────────────────────────────
  async function handleGoogle() {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`${API}/auth/google/url`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "Failed to get Google URL");
      // Redirect to Google
      window.location.href = d.url;
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  }

  return (
    <div style={s.overlay}>
      <div style={s.card}>
        {/* Logo */}
        <div style={s.logoRow}>
          <div style={s.logoIcon}>⚡</div>
          <div>
            <div style={s.logoTitle}>Knowledge Copilot</div>
            <div style={s.logoSub}>Semantic RAG Engine</div>
          </div>
        </div>

        <div style={s.divider} />

        <div style={s.formTitle}>Sign in to continue</div>

        {/* Username + Password form */}
        <form onSubmit={handleLogin} style={s.form}>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={s.input}
            autoFocus
            autoComplete="username"
          />
          <div style={s.pwWrap}>
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ ...s.input, marginBottom: 0 }}
              autoComplete="current-password"
            />
            <button
              type="button"
              style={s.eyeBtn}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? "🙈" : "👁"}
            </button>
          </div>

          {error && <div style={s.error}>{error}</div>}

          <button
            type="submit"
            style={s.loginBtn}
            disabled={loading || !username.trim() || !password.trim()}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {/* Divider */}
        <div style={s.orRow}>
          <div style={s.orLine} />
          <span style={s.orText}>or</span>
          <div style={s.orLine} />
        </div>

        {/* Google button */}
        <button style={s.googleBtn} onClick={handleGoogle} disabled={loading}>
          <svg width="18" height="18" viewBox="0 0 48 48" style={{ marginRight: 10 }}>
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Sign in with Google
        </button>

        <div style={s.hint}>
          Default credentials: <code style={s.code}>admin</code> / <code style={s.code}>skc-admin-2024</code>
          <br />
          <span style={s.hintSub}>Change these in your <code style={s.code}>.env</code> file</span>
        </div>
      </div>
    </div>
  );
}

const s = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "#0a0e14",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
  },
  card: {
    background: "#111827",
    border: "1px solid #1f2937",
    borderRadius: 16,
    padding: "36px 40px",
    width: 380,
    boxShadow: "0 25px 50px rgba(0,0,0,0.5)",
  },
  logoRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
  },
  logoIcon: {
    fontSize: 28,
    background: "#4A1F97",
    borderRadius: 10,
    width: 44,
    height: 44,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  logoTitle: { color: "#f9fafb", fontWeight: 700, fontSize: 16 },
  logoSub: { color: "#6b7280", fontSize: 12, marginTop: 2 },
  divider: { height: 1, background: "#1f2937", marginBottom: 24 },
  formTitle: { color: "#9ca3af", fontSize: 13, marginBottom: 16 },
  form: { display: "flex", flexDirection: "column", gap: 0 },
  input: {
    background: "#1f2937",
    border: "1px solid #374151",
    borderRadius: 8,
    color: "#f9fafb",
    padding: "10px 14px",
    fontSize: 14,
    marginBottom: 10,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  },
  pwWrap: { position: "relative", marginBottom: 10 },
  eyeBtn: {
    position: "absolute",
    right: 10,
    top: "50%",
    transform: "translateY(-50%)",
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: 16,
    padding: 0,
  },
  error: {
    color: "#f87171",
    fontSize: 13,
    marginBottom: 10,
    padding: "8px 12px",
    background: "#1f1010",
    borderRadius: 6,
    border: "1px solid #7f1d1d",
  },
  loginBtn: {
    background: "#4A1F97",
    border: "none",
    borderRadius: 8,
    color: "#fff",
    padding: "11px 0",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 4,
    width: "100%",
  },
  orRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    margin: "20px 0",
  },
  orLine: { flex: 1, height: 1, background: "#1f2937" },
  orText: { color: "#4b5563", fontSize: 12 },
  googleBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#1f2937",
    border: "1px solid #374151",
    borderRadius: 8,
    color: "#f9fafb",
    padding: "10px 0",
    fontSize: 14,
    cursor: "pointer",
    width: "100%",
    fontWeight: 500,
  },
  hint: {
    marginTop: 20,
    color: "#4b5563",
    fontSize: 11,
    textAlign: "center",
    lineHeight: 1.8,
  },
  hintSub: { color: "#374151" },
  code: {
    background: "#1f2937",
    padding: "1px 5px",
    borderRadius: 3,
    color: "#9ca3af",
    fontFamily: "monospace",
  },
};