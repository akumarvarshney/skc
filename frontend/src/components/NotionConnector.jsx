import { useState, useEffect } from "react";

const API = "http://localhost:8000";

export default function NotionConnector() {
  const [apiKey, setApiKey] = useState("");
  const [pages, setPages] = useState([]);
  const [selectedPages, setSelectedPages] = useState([]);
  const [syncAll, setSyncAll] = useState(true);
  const [schedules, setSchedules] = useState([]);
  const [status, setStatus] = useState(null); // { type: "success"|"error"|"loading", message }
  const [loadingPages, setLoadingPages] = useState(false);

  useEffect(() => {
    fetchSchedules();
  }, []);

  async function fetchSchedules() {
    try {
      const r = await fetch(`${API}/connectors/notion/sync/schedules`);
      const data = await r.json();
      setSchedules(data.schedules || []);
    } catch {}
  }

  async function handleFetchPages() {
    if (!apiKey.trim()) return setStatus({ type: "error", message: "Enter your Notion API key first." });
    setLoadingPages(true);
    setStatus({ type: "loading", message: "Fetching your Notion pages..." });
    try {
      const r = await fetch(`${API}/connectors/notion/pages?api_key=${encodeURIComponent(apiKey)}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Failed to fetch pages");
      setPages(data.pages || []);
      setStatus({ type: "success", message: `Found ${data.pages.length} pages.` });
    } catch (e) {
      setStatus({ type: "error", message: e.message });
    } finally {
      setLoadingPages(false);
    }
  }

  async function handleSync(schedule = false) {
    if (!apiKey.trim()) return setStatus({ type: "error", message: "Enter your Notion API key first." });
    setStatus({ type: "loading", message: schedule ? "Setting up hourly sync..." : "Syncing Notion content..." });

    const body = {
      api_key: apiKey,
      page_ids: syncAll ? null : selectedPages,
      namespace: "default",
    };

    const endpoint = schedule
      ? `${API}/connectors/notion/sync/schedule`
      : `${API}/connectors/notion/sync`;

    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Sync failed");
      setStatus({
        type: "success",
        message: schedule
          ? `✅ Hourly sync scheduled! ${data.message}`
          : `✅ ${data.message}`,
      });
      if (schedule) fetchSchedules();
    } catch (e) {
      setStatus({ type: "error", message: e.message });
    }
  }

  async function handleUnschedule(jobId) {
    try {
      await fetch(`${API}/connectors/notion/sync/schedule/${jobId}`, { method: "DELETE" });
      fetchSchedules();
      setStatus({ type: "success", message: "Schedule removed." });
    } catch (e) {
      setStatus({ type: "error", message: e.message });
    }
  }

  function togglePage(id) {
    setSelectedPages(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "24px", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <span style={{ fontSize: 28 }}>📝</span>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Notion Connector</h2>
          <p style={{ margin: 0, color: "#666", fontSize: 13 }}>
            Auto-index your Notion pages into the knowledge base
          </p>
        </div>
      </div>

      {/* API Key */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", marginBottom: 6, fontWeight: 600, fontSize: 14 }}>
          Notion API Key
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="secret_xxxxxxxxxxxx"
            style={{
              flex: 1, padding: "8px 12px", borderRadius: 8,
              border: "1px solid #ddd", fontSize: 14,
            }}
          />
          <button
            onClick={handleFetchPages}
            disabled={loadingPages}
            style={{
              padding: "8px 16px", borderRadius: 8, border: "none",
              background: "#6366f1", color: "#fff", cursor: "pointer", fontSize: 14,
            }}
          >
            {loadingPages ? "Loading..." : "Load Pages"}
          </button>
        </div>
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "#888" }}>
          Get your key at{" "}
          <a href="https://www.notion.so/my-integrations" target="_blank" rel="noreferrer">
            notion.so/my-integrations
          </a>
        </p>
      </div>

      {/* Page selection */}
      {pages.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", marginBottom: 8, fontWeight: 600, fontSize: 14 }}>
            Pages to Sync
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={syncAll}
              onChange={e => setSyncAll(e.target.checked)}
            />
            Sync all accessible pages ({pages.length} found)
          </label>
          {!syncAll && (
            <div style={{
              border: "1px solid #ddd", borderRadius: 8, maxHeight: 200,
              overflowY: "auto", padding: 8,
            }}>
              {pages.map(page => (
                <label
                  key={page.id}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13, cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={selectedPages.includes(page.id)}
                    onChange={() => togglePage(page.id)}
                  />
                  {page.title || "Untitled"}
                  <span style={{ color: "#aaa", fontSize: 11 }}>{page.id.slice(0, 8)}...</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Status message */}
      {status && (
        <div style={{
          padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 13,
          background: status.type === "error" ? "#fee2e2" : status.type === "success" ? "#dcfce7" : "#e0f2fe",
          color: status.type === "error" ? "#dc2626" : status.type === "success" ? "#16a34a" : "#0369a1",
        }}>
          {status.message}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
        <button
          onClick={() => handleSync(false)}
          style={{
            flex: 1, padding: "10px 0", borderRadius: 8, border: "none",
            background: "#6366f1", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 14,
          }}
        >
          🔄 Sync Now
        </button>
        <button
          onClick={() => handleSync(true)}
          style={{
            flex: 1, padding: "10px 0", borderRadius: 8, border: "none",
            background: "#059669", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 14,
          }}
        >
          ⏰ Schedule Hourly Sync
        </button>
      </div>

      {/* Active schedules */}
      {schedules.length > 0 && (
        <div>
          <h3 style={{ fontSize: 15, marginBottom: 10 }}>Active Schedules</h3>
          {schedules.map(s => (
            <div
              key={s.job_id}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 14px", borderRadius: 8, background: "#f9fafb",
                border: "1px solid #e5e7eb", marginBottom: 8, fontSize: 13,
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>Notion Auto-Sync</div>
                <div style={{ color: "#888" }}>Next run: {s.next_run}</div>
              </div>
              <button
                onClick={() => handleUnschedule(s.job_id)}
                style={{
                  padding: "4px 10px", borderRadius: 6, border: "1px solid #e5e7eb",
                  background: "#fff", cursor: "pointer", color: "#dc2626", fontSize: 12,
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Webhook info */}
      <div style={{
        marginTop: 24, padding: "12px 16px", borderRadius: 8,
        background: "#fafafa", border: "1px solid #e5e7eb", fontSize: 13,
      }}>
        <strong>🔔 Webhook URL</strong> (for real-time updates):
        <code style={{
          display: "block", marginTop: 6, padding: "6px 10px",
          background: "#f3f4f6", borderRadius: 6, fontSize: 12, wordBreak: "break-all",
        }}>
          http://your-server:8000/connectors/notion/webhook
        </code>
        <p style={{ margin: "6px 0 0", color: "#888" }}>
          Paste this URL in your Notion integration webhook settings to get instant updates when pages change.
        </p>
      </div>
    </div>
  );
}