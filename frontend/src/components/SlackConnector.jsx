/**
 * SlackConnector.jsx
 * Follows the same UI pattern as NotionConnector.jsx and GoogleDriveConnector.jsx
 *
 * Flow:
 *   1. Paste a Bot Token → POST /connectors/slack/connect
 *   2. Fetch available channels → GET /connectors/slack/channels
 *   3. Select channels → POST /connectors/slack/channels/select
 *   4. Trigger sync → POST /connectors/slack/sync
 */

import { useState, useEffect } from "react";

const API = "http://localhost:8000";

export default function SlackConnector() {
  const [status, setStatus] = useState(null);          // from /status
  const [open, setOpen] = useState(false);             // modal open
  const [step, setStep] = useState("token");           // token | channels | syncing
  const [botToken, setBotToken] = useState("");
  const [allChannels, setAllChannels] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [daysBack, setDaysBack] = useState(30);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // Poll status every 8 s while syncing, otherwise on mount + modal open
  useEffect(() => {
    fetchStatus();
  }, [open]);

  async function fetchStatus() {
    try {
      const r = await fetch(`${API}/connectors/slack/status`);
      const d = await r.json();
      setStatus(d);
      if (d.connected) {
        setStep("channels");
        setSelectedIds(d.selected_channels?.map((c) => c.id) || []);
      }
    } catch (_) {}
  }

  // ── Connect with Bot Token ──────────────────────────────────────────────
  async function handleConnect() {
    if (!botToken.trim()) return;
    setLoading(true);
    setMessage("");
    try {
      const r = await fetch(`${API}/connectors/slack/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bot_token: botToken.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "Connection failed");
      setMessage(`✅ Connected to ${d.team}`);
      await fetchStatus();
      await handleLoadChannels();
    } catch (e) {
      setMessage(`❌ ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  // ── Disconnect ──────────────────────────────────────────────────────────
  async function handleDisconnect() {
    await fetch(`${API}/connectors/slack/disconnect`, { method: "POST" });
    setStep("token");
    setBotToken("");
    setAllChannels([]);
    setSelectedIds([]);
    setMessage("");
    fetchStatus();
  }

  // ── Load channel list ───────────────────────────────────────────────────
  async function handleLoadChannels() {
    setLoading(true);
    try {
      const r = await fetch(`${API}/connectors/slack/channels`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "Failed to load channels");
      setAllChannels(d.channels || []);
      setStep("channels");
    } catch (e) {
      setMessage(`❌ ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  // ── Toggle channel selection ────────────────────────────────────────────
  function toggleChannel(id) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  // ── Save channel selection + sync ───────────────────────────────────────
  async function handleSync() {
    if (selectedIds.length === 0) {
      setMessage("⚠️ Select at least one channel.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      // 1. Save selection
      const selectR = await fetch(`${API}/connectors/slack/channels/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_ids: selectedIds }),
      });
      if (!selectR.ok) throw new Error("Failed to save channel selection");

      // 2. Kick off sync
      const syncR = await fetch(`${API}/connectors/slack/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days_back: daysBack }),
      });
      const syncD = await syncR.json();
      if (!syncR.ok) throw new Error(syncD.detail || "Sync failed");

      setMessage(`⏳ ${syncD.message}. Check back in a moment.`);
      setStep("syncing");
      // Refresh status after a delay
      setTimeout(() => {
        fetchStatus();
        setStep("channels");
      }, 5000);
    } catch (e) {
      setMessage(`❌ ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // UI helpers
  // ────────────────────────────────────────────────────────────────────────

  const isConnected = status?.connected;

  return (
    <>
      {/* ── Row in Connectors list ── */}
      <div style={styles.row}>
        <div style={styles.iconWrap}>
          {/* Slack hash-mark icon */}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="M14.5 2C13.12 2 12 3.12 12 4.5V9.5H17.5C18.88 9.5 20 8.38 20 7C20 5.62 18.88 4.5 17.5 4.5H16V4.5C16 3.12 14.88 2 13.5 2H14.5Z"
              fill="#E01E5A"
            />
            <path
              d="M2 14.5C2 15.88 3.12 17 4.5 17H9.5V11.5H4.5C3.12 11.5 2 12.62 2 14V14.5Z"
              fill="#36C5F0"
            />
            <path
              d="M11.5 22C12.88 22 14 20.88 14 19.5V14.5H8.5C7.12 14.5 6 15.62 6 17C6 18.38 7.12 19.5 8.5 19.5H10V19.5C10 20.88 11.12 22 12.5 22H11.5Z"
              fill="#2EB67D"
            />
            <path
              d="M22 9.5C22 8.12 20.88 7 19.5 7H14.5V12.5H19.5C20.88 12.5 22 11.38 22 10V9.5Z"
              fill="#ECB22E"
            />
            <circle cx="7" cy="7" r="2.5" fill="#36C5F0" />
            <circle cx="17" cy="17" r="2.5" fill="#2EB67D" />
          </svg>
        </div>
        <div style={styles.info}>
          <div style={styles.name}>Slack</div>
          <div style={styles.desc}>
            {isConnected
              ? `Connected to ${status.team_name} · ${status.selected_channels?.length || 0} channel(s) · ${status.indexed_count || 0} messages indexed`
              : "Index messages from selected channels in real-time"}
          </div>
        </div>
        <button style={styles.configBtn} onClick={() => setOpen(true)}>
          {isConnected ? "Manage" : "Configure"}
        </button>
      </div>

      {/* ── Modal ── */}
      {open && (
        <div style={styles.overlay} onClick={() => setOpen(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div style={styles.modalHeader}>
              <span style={styles.modalTitle}>Slack Connector</span>
              <button style={styles.closeBtn} onClick={() => setOpen(false)}>✕</button>
            </div>

            {/* Content */}
            <div style={styles.modalBody}>

              {/* STEP 1 — Token input */}
              {!isConnected && step === "token" && (
                <div>
                  <p style={styles.helpText}>
                    Paste your Slack <strong>Bot Token</strong> (starts with <code>xoxb-</code>).{" "}
                    <a
                      href="https://api.slack.com/apps"
                      target="_blank"
                      rel="noreferrer"
                      style={styles.link}
                    >
                      Get it from api.slack.com/apps →
                    </a>
                  </p>
                  <p style={styles.scopeNote}>
                    Required scopes: <code>channels:history</code>, <code>channels:read</code>,{" "}
                    <code>groups:history</code>, <code>groups:read</code>, <code>users:read</code>
                  </p>
                  <input
                    type="password"
                    placeholder="xoxb-..."
                    value={botToken}
                    onChange={(e) => setBotToken(e.target.value)}
                    style={styles.input}
                    onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                  />
                  <button
                    style={styles.primaryBtn}
                    onClick={handleConnect}
                    disabled={loading || !botToken.trim()}
                  >
                    {loading ? "Connecting…" : "Connect"}
                  </button>
                </div>
              )}

              {/* STEP 2 — Channel selection */}
              {isConnected && step !== "syncing" && (
                <div>
                  <div style={styles.connectedBadge}>
                    ✅ Connected to <strong>{status?.team_name}</strong>
                    <button style={styles.disconnectBtn} onClick={handleDisconnect}>
                      Disconnect
                    </button>
                  </div>

                  {allChannels.length === 0 && (
                    <button style={styles.secondaryBtn} onClick={handleLoadChannels} disabled={loading}>
                      {loading ? "Loading…" : "Load Channels"}
                    </button>
                  )}

                  {allChannels.length > 0 && (
                    <>
                      <p style={styles.subLabel}>Select channels to index:</p>
                      <div style={styles.channelList}>
                        {allChannels.map((ch) => (
                          <label key={ch.id} style={styles.channelRow}>
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(ch.id)}
                              onChange={() => toggleChannel(ch.id)}
                              style={{ marginRight: 8 }}
                            />
                            <span style={styles.channelHash}>#</span>
                            {ch.name}
                            {ch.is_private && (
                              <span style={styles.privateBadge}>private</span>
                            )}
                          </label>
                        ))}
                      </div>

                      <div style={styles.daysRow}>
                        <label style={styles.subLabel}>Days of history to index:</label>
                        <select
                          value={daysBack}
                          onChange={(e) => setDaysBack(Number(e.target.value))}
                          style={styles.select}
                        >
                          {[7, 14, 30, 60, 90].map((d) => (
                            <option key={d} value={d}>{d} days</option>
                          ))}
                        </select>
                      </div>

                      <button
                        style={styles.primaryBtn}
                        onClick={handleSync}
                        disabled={loading || selectedIds.length === 0}
                      >
                        {loading ? "Starting sync…" : `Sync ${selectedIds.length} channel(s)`}
                      </button>
                    </>
                  )}

                  {status?.last_sync && (
                    <p style={styles.lastSync}>
                      Last synced: {new Date(status.last_sync).toLocaleString()} ·{" "}
                      {status.indexed_count} messages indexed
                    </p>
                  )}
                </div>
              )}

              {/* Syncing state */}
              {step === "syncing" && (
                <p style={styles.helpText}>⏳ Sync running in the background…</p>
              )}

              {/* Status message */}
              {message && <p style={styles.messageText}>{message}</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Styles (matches dark theme of the app) ─────────────────────────────────
const styles = {
  row: {
    display: "flex",
    alignItems: "center",
    padding: "18px 24px",
    borderBottom: "1px solid #2a2a2a",
    gap: 16,
  },
  iconWrap: {
    width: 36,
    height: 36,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  info: { flex: 1 },
  name: { color: "#e0e0e0", fontWeight: 500, fontSize: 14 },
  desc: { color: "#888", fontSize: 12, marginTop: 2 },
  configBtn: {
    background: "transparent",
    border: "1px solid #444",
    color: "#e0e0e0",
    borderRadius: 6,
    padding: "6px 16px",
    cursor: "pointer",
    fontSize: 13,
    whiteSpace: "nowrap",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  modal: {
    background: "#1a1a1a",
    border: "1px solid #333",
    borderRadius: 10,
    width: 480,
    maxHeight: "80vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 20px",
    borderBottom: "1px solid #2a2a2a",
  },
  modalTitle: { color: "#e0e0e0", fontWeight: 600, fontSize: 15 },
  closeBtn: {
    background: "none",
    border: "none",
    color: "#888",
    cursor: "pointer",
    fontSize: 16,
  },
  modalBody: { padding: 20, overflowY: "auto" },
  helpText: { color: "#aaa", fontSize: 13, marginBottom: 12, lineHeight: 1.5 },
  scopeNote: { color: "#666", fontSize: 11, marginBottom: 14, lineHeight: 1.6 },
  input: {
    width: "100%",
    background: "#111",
    border: "1px solid #333",
    borderRadius: 6,
    color: "#e0e0e0",
    padding: "8px 12px",
    fontSize: 13,
    marginBottom: 12,
    boxSizing: "border-box",
  },
  primaryBtn: {
    background: "#4A1F97",
    border: "none",
    borderRadius: 6,
    color: "#fff",
    padding: "8px 18px",
    cursor: "pointer",
    fontSize: 13,
    marginTop: 4,
  },
  secondaryBtn: {
    background: "transparent",
    border: "1px solid #444",
    borderRadius: 6,
    color: "#e0e0e0",
    padding: "8px 18px",
    cursor: "pointer",
    fontSize: 13,
    marginTop: 4,
  },
  connectedBadge: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    color: "#aaa",
    fontSize: 13,
    marginBottom: 16,
  },
  disconnectBtn: {
    background: "none",
    border: "1px solid #555",
    color: "#888",
    borderRadius: 4,
    padding: "3px 10px",
    cursor: "pointer",
    fontSize: 11,
    marginLeft: "auto",
  },
  subLabel: { color: "#aaa", fontSize: 12, marginBottom: 8 },
  channelList: {
    maxHeight: 200,
    overflowY: "auto",
    border: "1px solid #2a2a2a",
    borderRadius: 6,
    padding: 8,
    marginBottom: 12,
  },
  channelRow: {
    display: "flex",
    alignItems: "center",
    color: "#ccc",
    fontSize: 13,
    padding: "4px 0",
    cursor: "pointer",
  },
  channelHash: { color: "#666", marginRight: 2 },
  privateBadge: {
    marginLeft: 6,
    fontSize: 10,
    background: "#2a2a2a",
    border: "1px solid #444",
    color: "#888",
    borderRadius: 4,
    padding: "1px 5px",
  },
  daysRow: { display: "flex", alignItems: "center", gap: 12, marginBottom: 12 },
  select: {
    background: "#111",
    border: "1px solid #333",
    borderRadius: 6,
    color: "#e0e0e0",
    padding: "5px 10px",
    fontSize: 12,
  },
  lastSync: { color: "#555", fontSize: 11, marginTop: 12 },
  messageText: { color: "#ccc", fontSize: 13, marginTop: 12 },
  link: { color: "#7c4dff" },
};