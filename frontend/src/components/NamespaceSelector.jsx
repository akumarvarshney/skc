/**
 * NamespaceSelector.jsx
 *
 * A dropdown + management panel for Pinecone namespaces.
 * Used in both the Ask Questions tab and the Upload area.
 *
 * Props:
 *   value       {string}   — currently selected namespace slug
 *   onChange    {fn}       — called with new slug when user selects
 *   compact     {bool}     — if true, shows only the dropdown (no manage button)
 */

import { useState, useEffect } from "react";

const API = "http://localhost:8000";

export default function NamespaceSelector({ value, onChange, compact = false }) {
  const [namespaces, setNamespaces] = useState([]);
  const [showManager, setShowManager] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDisplay, setNewDisplay] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchNamespaces();
  }, []);

  async function fetchNamespaces() {
    try {
      const r = await fetch(`${API}/namespaces`);
      const d = await r.json();
      setNamespaces(d);
      // If current value no longer exists, reset to default
      if (!d.find((n) => n.name === value)) {
        onChange("default");
      }
    } catch (_) {}
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    setError("");
    try {
      const r = await fetch(`${API}/namespaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          display_name: newDisplay.trim() || newName.trim(),
          description: newDesc.trim(),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "Failed to create");
      setNewName("");
      setNewDisplay("");
      setNewDesc("");
      await fetchNamespaces();
      onChange(d.name);
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(name) {
    if (!window.confirm(`Delete namespace "${name}" and all its vectors? This cannot be undone.`)) return;
    try {
      const r = await fetch(`${API}/namespaces/${name}`, { method: "DELETE" });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.detail);
      }
      if (value === name) onChange("default");
      await fetchNamespaces();
    } catch (e) {
      setError(e.message);
    }
  }

  const selected = namespaces.find((n) => n.name === value);

  return (
    <div style={styles.wrap}>
      {/* ── Dropdown ── */}
      <div style={styles.row}>
        <span style={styles.label}>Knowledge base:</span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={styles.select}
        >
          {namespaces.map((ns) => (
            <option key={ns.name} value={ns.name}>
              {ns.display_name}
              {ns.description ? ` — ${ns.description}` : ""}
            </option>
          ))}
        </select>
        {!compact && (
          <button
            style={styles.manageBtn}
            onClick={() => setShowManager((v) => !v)}
          >
            {showManager ? "Close" : "Manage"}
          </button>
        )}
      </div>

      {/* ── Manager panel ── */}
      {showManager && (
        <div style={styles.panel}>
          <div style={styles.panelTitle}>Manage Knowledge Bases</div>

          {/* Existing namespaces */}
          <div style={styles.nsList}>
            {namespaces.map((ns) => (
              <div key={ns.name} style={styles.nsRow}>
                <div>
                  <span style={styles.nsName}>{ns.display_name}</span>
                  <span style={styles.nsSlug}> ({ns.name})</span>
                  {ns.description && (
                    <span style={styles.nsDesc}> — {ns.description}</span>
                  )}
                </div>
                {ns.name !== "default" && (
                  <button
                    style={styles.deleteBtn}
                    onClick={() => handleDelete(ns.name)}
                  >
                    Delete
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Create new */}
          <div style={styles.createSection}>
            <div style={styles.createTitle}>Create new knowledge base</div>
            <input
              placeholder="Slug (e.g. product-team)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={styles.input}
            />
            <input
              placeholder="Display name (e.g. Product Team)"
              value={newDisplay}
              onChange={(e) => setNewDisplay(e.target.value)}
              style={styles.input}
            />
            <input
              placeholder="Description (optional)"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              style={styles.input}
            />
            <button
              style={styles.createBtn}
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
            >
              {creating ? "Creating…" : "Create"}
            </button>
            {error && <p style={styles.error}>{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  wrap: { marginBottom: 12, position: "relative", zIndex: 100 },
  row: { display: "flex", alignItems: "center", gap: 10 },
  label: { color: "#888", fontSize: 12, whiteSpace: "nowrap" },
  select: {
    flex: 1,
    background: "#111",
    border: "1px solid #2a2a2a",
    borderRadius: 6,
    color: "#e0e0e0",
    padding: "6px 10px",
    fontSize: 13,
  },
  manageBtn: {
    background: "transparent",
    border: "1px solid #333",
    color: "#888",
    borderRadius: 5,
    padding: "5px 12px",
    cursor: "pointer",
    fontSize: 12,
    whiteSpace: "nowrap",
  },
  panel: {
    marginTop: 10,
    background: "#111",
    border: "1px solid #2a2a2a",
    borderRadius: 8,
    padding: 16,
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 200,
    minWidth: 320,
},
  panelTitle: { color: "#ccc", fontWeight: 600, fontSize: 13, marginBottom: 12 },
  nsList: { marginBottom: 16 },
  nsRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "6px 0",
    borderBottom: "1px solid #1a1a1a",
  },
  nsName: { color: "#e0e0e0", fontSize: 13 },
  nsSlug: { color: "#555", fontSize: 11 },
  nsDesc: { color: "#666", fontSize: 11 },
  deleteBtn: {
    background: "none",
    border: "1px solid #4a1a1a",
    color: "#c04040",
    borderRadius: 4,
    padding: "2px 10px",
    cursor: "pointer",
    fontSize: 11,
  },
  createSection: { borderTop: "1px solid #2a2a2a", paddingTop: 12 },
  createTitle: { color: "#aaa", fontSize: 12, marginBottom: 8 },
  input: {
    display: "block",
    width: "100%",
    background: "#0d0d0d",
    border: "1px solid #2a2a2a",
    borderRadius: 5,
    color: "#e0e0e0",
    padding: "6px 10px",
    fontSize: 12,
    marginBottom: 6,
    boxSizing: "border-box",
  },
  createBtn: {
    background: "#4A1F97",
    border: "none",
    borderRadius: 5,
    color: "#fff",
    padding: "6px 16px",
    cursor: "pointer",
    fontSize: 12,
    marginTop: 4,
  },
  error: { color: "#c04040", fontSize: 12, marginTop: 6 },
};