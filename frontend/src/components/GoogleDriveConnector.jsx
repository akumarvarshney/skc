/**
 * GoogleDriveConnector.jsx
 * Wires up the Google Drive connector row with a real Configure button.
 * Replace the existing placeholder in your Connectors page.
 *
 * Backend endpoints (already confirmed working at localhost:8000/docs):
 *   GET  /connectors/gdrive/status
 *   GET  /connectors/gdrive/oauth/url
 *   GET  /connectors/gdrive/oauth/callback   (handled by redirect)
 *   POST /connectors/gdrive/sync
 *   POST /connectors/gdrive/disconnect
 */

import { useState, useEffect } from "react";

const API = "http://localhost:8000";

export default function GoogleDriveConnector() {
  const [status, setStatus] = useState(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetchStatus();
    // If returning from OAuth redirect, modal won't be open —
    // check for ?gdrive=connected in URL (optional enhancement)
  }, [open]);

  async function fetchStatus() {
    try {
      const r = await fetch(`${API}/connectors/gdrive/status`);
      const d = await r.json();
      setStatus(d);
    } catch (_) {}
  }

  async function handleConnect() {
    setLoading(true);
    setMessage("");
    try {
      const r = await fetch(`${API}/connectors/gdrive/oauth/url`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "Failed to get OAuth URL");
      // Open Google OAuth in current tab (it redirects back)
      window.location.href = d.url;
    } catch (e) {
      setMessage(`❌ ${e.message}`);
      setLoading(false);
    }
  }

  async function handleSync() {
    setLoading(true);
    setMessage("");
    try {
      const r = await fetch(`${API}/connectors/gdrive/sync`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "Sync failed");
      setMessage(`⏳ ${d.message}`);
      setTimeout(fetchStatus, 4000);
    } catch (e) {
      setMessage(`❌ ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnect() {
    await fetch(`${API}/connectors/gdrive/disconnect`, { method: "POST" });
    setMessage("");
    fetchStatus();
  }

  const isConnected = status?.connected;

  return (
    <>
      {/* Row */}
      <div style={styles.row}>
        <div style={styles.iconWrap}>
          {/* Drive folder icon */}
          <svg width="22" height="22" viewBox="0 0 87.3 78" fill="none">
            <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0a15.92 15.92 0 003.35 8.1z" fill="#0066DA"/>
            <path d="M43.65 25L29.9 1.2a10.63 10.63 0 00-3.3 3.3L.45 47.5a15.89 15.89 0 00-2.1 8.1h27.5z" fill="#00AC47"/>
            <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25a15.89 15.89 0 002.1-8.1H60.7l5.85 11.65z" fill="#EA4335"/>
            <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832D"/>
            <path d="M60.7 55.6H27.3L13.55 79.1c1.35.8 2.9 1.2 4.5 1.2h50.3c1.6 0 3.15-.4 4.5-1.2z" fill="#2684FC"/>
            <path d="M73.4 26.5l-13.6-23.5a10.63 10.63 0 00-2.4-1.8L43.65 25l17.05 30.6H87.8a15.89 15.89 0 00-2.1-8.1z" fill="#FFBA00"/>
          </svg>
        </div>
        <div style={styles.info}>
          <div style={styles.name}>Google Drive</div>
          <div style={styles.desc}>
            {isConnected
              ? `Connected · ${status?.indexed_count || 0} files indexed${status?.last_sync ? ` · Last sync: ${new Date(status.last_sync).toLocaleDateString()}` : ""}`
              : "Auto-index Docs, PDFs and Sheets from your Drive"}
          </div>
        </div>
        <button style={styles.configBtn} onClick={() => setOpen(true)}>
          {isConnected ? "Manage" : "Configure"}
        </button>
      </div>

      {/* Modal */}
      {open && (
        <div style={styles.overlay} onClick={() => setOpen(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={styles.modalTitle}>Google Drive Connector</span>
              <button style={styles.closeBtn} onClick={() => setOpen(false)}>✕</button>
            </div>
            <div style={styles.modalBody}>
              {!isConnected ? (
                <div>
                  <p style={styles.helpText}>
                    Connect your Google Drive to automatically index Docs, PDFs, and Sheets into your knowledge base.
                  </p>
                  <button style={styles.primaryBtn} onClick={handleConnect} disabled={loading}>
                    {loading ? "Redirecting…" : "Connect Google Drive"}
                  </button>
                </div>
              ) : (
                <div>
                  <div style={styles.connectedBadge}>
                    ✅ Google Drive connected
                    <button style={styles.disconnectBtn} onClick={handleDisconnect}>
                      Disconnect
                    </button>
                  </div>
                  {status?.last_sync && (
                    <p style={styles.lastSync}>
                      Last synced: {new Date(status.last_sync).toLocaleString()} ·{" "}
                      {status.indexed_count} files indexed
                    </p>
                  )}
                  <button style={styles.primaryBtn} onClick={handleSync} disabled={loading}>
                    {loading ? "Syncing…" : "Sync Now"}
                  </button>
                </div>
              )}
              {message && <p style={styles.messageText}>{message}</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const styles = {
  row: { display:"flex", alignItems:"center", padding:"18px 24px", borderBottom:"1px solid #2a2a2a", gap:16 },
  iconWrap: { width:36, height:36, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 },
  info: { flex:1 },
  name: { color:"#e0e0e0", fontWeight:500, fontSize:14 },
  desc: { color:"#888", fontSize:12, marginTop:2 },
  configBtn: { background:"transparent", border:"1px solid #444", color:"#e0e0e0", borderRadius:6, padding:"6px 16px", cursor:"pointer", fontSize:13, whiteSpace:"nowrap" },
  overlay: { position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 },
  modal: { background:"#1a1a1a", border:"1px solid #333", borderRadius:10, width:440, display:"flex", flexDirection:"column" },
  modalHeader: { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"16px 20px", borderBottom:"1px solid #2a2a2a" },
  modalTitle: { color:"#e0e0e0", fontWeight:600, fontSize:15 },
  closeBtn: { background:"none", border:"none", color:"#888", cursor:"pointer", fontSize:16 },
  modalBody: { padding:20 },
  helpText: { color:"#aaa", fontSize:13, marginBottom:14, lineHeight:1.5 },
  primaryBtn: { background:"#4A1F97", border:"none", borderRadius:6, color:"#fff", padding:"8px 18px", cursor:"pointer", fontSize:13 },
  connectedBadge: { display:"flex", alignItems:"center", gap:10, color:"#aaa", fontSize:13, marginBottom:12 },
  disconnectBtn: { background:"none", border:"1px solid #555", color:"#888", borderRadius:4, padding:"3px 10px", cursor:"pointer", fontSize:11, marginLeft:"auto" },
  lastSync: { color:"#555", fontSize:11, marginBottom:12 },
  messageText: { color:"#ccc", fontSize:13, marginTop:12 },
};