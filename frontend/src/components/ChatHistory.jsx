/**
 * ChatHistory.jsx
 *
 * Sidebar panel showing saved conversations per namespace.
 * Props:
 *   namespace     {string}   — current namespace
 *   onRestore     {fn}       — called with messages[] when user clicks a conversation
 *   currentMsgs   {array}    — current messages (to save)
 *   onSaved       {fn}       — called after successful save
 */

import { useState, useEffect } from "react";

const API = "https://skc-production.up.railway.app";

function authHeaders() {
  const t = localStorage.getItem("skc_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export default function ChatHistory({ namespace, onRestore, currentMsgs, onSaved }) {
  const [conversations, setConversations] = useState([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    if (open) fetchHistory();
  }, [open, namespace]);

  async function fetchHistory() {
    try {
      const r = await fetch(`${API}/history/${namespace}`, {
        headers: authHeaders(),
      });
      const d = await r.json();
      setConversations(Array.isArray(d) ? d : []);
    } catch (_) {
      setConversations([]);
    }
  }

  async function handleSave() {
    const realMsgs = currentMsgs.filter(
      (m) => m.role === "user" || m.role === "assistant"
    );
    if (realMsgs.length === 0) {
      setSaveMsg("Nothing to save yet.");
      setTimeout(() => setSaveMsg(""), 2000);
      return;
    }
    setSaving(true);
    setSaveMsg("");
    try {
      const r = await fetch(`${API}/history/${namespace}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ messages: realMsgs, namespace }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "Save failed");
      setSaveMsg("✅ Saved!");
      await fetchHistory();
      if (onSaved) onSaved(d.id);
    } catch (e) {
      setSaveMsg(`❌ ${e.message}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 3000);
    }
  }

  async function handleRestore(conv) {
    try {
      const r = await fetch(`${API}/history/${namespace}/${conv.id}`, {
        headers: authHeaders(),
      });
      const d = await r.json();
      if (!r.ok) throw new Error("Failed to load");
      onRestore(d.messages);
      setOpen(false);
    } catch (e) {
      alert(`Failed to load conversation: ${e.message}`);
    }
  }

  async function handleDelete(e, conv) {
    e.stopPropagation();
    if (!window.confirm(`Delete "${conv.title}"?`)) return;
    setDeleting(conv.id);
    try {
      await fetch(`${API}/history/${namespace}/${conv.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      await fetchHistory();
    } catch (_) {}
    setDeleting(null);
  }

  async function handleClearAll() {
    if (!window.confirm(`Delete ALL history for namespace "${namespace}"?`)) return;
    try {
      await fetch(`${API}/history/${namespace}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      setConversations([]);
    } catch (_) {}
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  }

  return (
    <div style={s.wrap}>
      {/* ── Toggle + Save row ── */}
      <div style={s.topRow}>
        <button style={s.historyBtn} onClick={() => setOpen((v) => !v)}>
          🕐 {open ? "Hide History" : "Chat History"}
        </button>
        <button style={s.saveBtn} onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {saveMsg && <div style={s.saveMsg}>{saveMsg}</div>}

      {/* ── History panel ── */}
      {open && (
        <div style={s.panel}>
          <div style={s.panelHeader}>
            <span style={s.panelTitle}>
              {conversations.length} conversation{conversations.length !== 1 ? "s" : ""}
            </span>
            {conversations.length > 0 && (
              <button style={s.clearBtn} onClick={handleClearAll}>
                Clear all
              </button>
            )}
          </div>

          {conversations.length === 0 ? (
            <div style={s.empty}>No saved conversations yet. Ask questions and click Save.</div>
          ) : (
            <div style={s.list}>
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  style={s.convRow}
                  onClick={() => handleRestore(conv)}
                >
                  <div style={s.convInfo}>
                    <div style={s.convTitle}>{conv.title}</div>
                    <div style={s.convMeta}>
                      {conv.message_count} messages · {formatDate(conv.updated_at)}
                    </div>
                  </div>
                  <button
                    style={s.deleteBtn}
                    onClick={(e) => handleDelete(e, conv)}
                    disabled={deleting === conv.id}
                  >
                    {deleting === conv.id ? "…" : "✕"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const s = {
  wrap: { marginBottom: 8 },
  topRow: { display: "flex", gap: 6, alignItems: "center" },
  historyBtn: {
    flex: 1,
    background: "transparent",
    border: "1px solid #1f2937",
    color: "#6b7280",
    borderRadius: 6,
    padding: "5px 10px",
    cursor: "pointer",
    fontSize: 11,
    textAlign: "left",
  },
  saveBtn: {
    background: "#4A1F97",
    border: "none",
    color: "#fff",
    borderRadius: 6,
    padding: "5px 12px",
    cursor: "pointer",
    fontSize: 11,
    whiteSpace: "nowrap",
  },
  saveMsg: { color: "#9ca3af", fontSize: 11, marginTop: 4 },
  panel: {
    marginTop: 8,
    background: "#0d1117",
    border: "1px solid #1f2937",
    borderRadius: 8,
    overflow: "hidden",
    position: "absolute",
    left: 8,
    right: 8,
    zIndex: 300,
    maxHeight: 320,
    display: "flex",
    flexDirection: "column",
  },
  panelHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 12px",
    borderBottom: "1px solid #1f2937",
  },
  panelTitle: { color: "#6b7280", fontSize: 11 },
  clearBtn: {
    background: "none",
    border: "1px solid #4a1a1a",
    color: "#c04040",
    borderRadius: 4,
    padding: "2px 8px",
    cursor: "pointer",
    fontSize: 10,
  },
  empty: { color: "#374151", fontSize: 12, padding: 16, textAlign: "center" },
  list: { overflowY: "auto", flex: 1 },
  convRow: {
    display: "flex",
    alignItems: "center",
    padding: "8px 12px",
    cursor: "pointer",
    borderBottom: "1px solid #111",
    gap: 8,
    transition: "background 0.15s",
  },
  convInfo: { flex: 1, minWidth: 0 },
  convTitle: {
    color: "#d1d5db",
    fontSize: 12,
    fontWeight: 500,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  convMeta: { color: "#4b5563", fontSize: 10, marginTop: 2 },
  deleteBtn: {
    background: "none",
    border: "none",
    color: "#374151",
    cursor: "pointer",
    fontSize: 14,
    padding: "0 4px",
    flexShrink: 0,
  },
};