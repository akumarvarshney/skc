import { useState, useRef, useEffect } from "react";
import NotionConnector from "./components/NotionConnector";
import GoogleDriveConnector from "./components/GoogleDriveConnector";
import SlackConnector from "./components/SlackConnector";
import NamespaceSelector from "./components/NamespaceSelector";
import LoginPage from "./components/LoginPage";
import ChatHistory from "./components/ChatHistory";

const API = "http://localhost:8000";
const authHeaders = () => { const t = localStorage.getItem("skc_token"); return t ? { "Authorization": `Bearer ${t}` } : {}; };

const fmt_size = (b) => b > 1048576 ? `${(b/1048576).toFixed(1)}MB` : `${(b/1024).toFixed(0)}KB`;
const fmt_time = (ms) => ms > 1000 ? `${(ms/1000).toFixed(1)}s` : `${ms}ms`;

const Icon = ({ d, size = 16, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

export default function App() {
  const [tab, setTab] = useState("query"); // "query" | "sources" | "connectors"
  const [sources, setSources] = useState([]);
  const [messages, setMessages] = useState([
    { role: "system", text: "Knowledge base is ready. Upload documents and start asking questions." }
  ]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();
  const chatRef = useRef();
  const [namespace, setNamespace] = useState("default");
  const [user, setUser] = useState(() => {
  const token = localStorage.getItem("skc_token");
  const saved = localStorage.getItem("skc_user");
  if (token && saved) return JSON.parse(saved);
  return null;
});

function handleLogin(userData) { setUser(userData); }

function handleLogout() {
  localStorage.removeItem("skc_token");
  localStorage.removeItem("skc_user");
  setUser(null);
}
function handleRestore(msgs) {
  setMessages(msgs);
}

  useEffect(() => { fetchSources(); }, []);
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  async function fetchSources() {
    try {
      const r = await fetch(`${API}/ingest/sources`);
      const d = await r.json();
      setSources(d.sources || []);
    } catch { }
  }

  async function uploadFile(file) {
    if (!file) return;
    const allowed = [".pdf", ".docx", ".txt"];
    const ext = "." + file.name.split(".").pop().toLowerCase();
    if (!allowed.includes(ext)) {
      addMessage("system-error", `Unsupported file type. Allowed: PDF, DOCX, TXT`);
      return;
    }
    setUploading(true);
    addMessage("system", `Indexing "${file.name}"...`);
    try {
      const form = new FormData();
      form.append("file", file);
      formData.append("namespace", namespace);
      const r = await fetch(`${API}/ingest/upload`, { method: "POST", body: form });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "Upload failed");
      if (d.skipped) {
        addMessage("system", `"${file.name}" was already indexed.`);
      } else {
        addMessage("system-success",
          `✓ "${file.name}" indexed — ${d.chunks_created} chunks created in ${d.processing_time_seconds}s`
        );
      }
      fetchSources();
    } catch (e) {
      addMessage("system-error", `Failed to index "${file.name}": ${e.message}`);
    } finally {
      setUploading(false);
    }
  }

  async function submitQuery() {
    const q = question.trim();
    if (!q || loading) return;
    setQuestion("");
    setMessages(m => [...m, { role: "user", text: q }]);
    setLoading(true);
    try {
      const r = await fetch(`${API}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, top_k: 6, namespace: namespace }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "Query failed");
      setMessages(m => [...m, {
        role: "assistant",
        text: d.answer,
        sources: d.sources,
        chunks_used: d.chunks_used,
        latency_ms: d.latency_ms,
        model: d.model,
      }]);
    } catch (e) {
      setMessages(m => [...m, { role: "system-error", text: `Error: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  async function deleteSource(id) {
    await fetch(`${API}/ingest/sources/${id}`, { method: "DELETE" });
    fetchSources();
  }

  function addMessage(role, text) {
    setMessages(m => [...m, { role, text }]);
  }

  if (!user) return <LoginPage onLogin={handleLogin} />;
  return (
    <div style={s.root}>
      {/* Sidebar */}
      <aside style={s.sidebar}>
        <div style={s.logo}>
          <span style={s.logoIcon}>⬡</span>
          <div>
            <div style={s.logoTitle}>Knowledge Copilot</div>
            <div style={s.logoSub}>Semantic RAG Engine</div>
          </div>
        </div>

        <nav style={s.nav}>
          {[
            ["query", "💬", "Ask Questions"],
            ["sources", "📁", "Manage Sources"],
            ["connectors", "🔌", "Connectors"],
          ].map(([id, icon, label]) => (
            <button key={id} style={{ ...s.navBtn, ...(tab === id ? s.navBtnActive : {}) }}
              onClick={() => setTab(id)}>
              <span>{icon}</span> {label}
            </button>
          ))}
        </nav>
        <button onClick={handleLogout} style={{ background:"none", border:"1px solid #1f2937", color:"#6b7280", borderRadius:6, padding:"6px 12px", cursor:"pointer", fontSize:12, margin:"8px 0" }}>
  Logout {user?.username}
</button>
<ChatHistory
  namespace={namespace}
  currentMsgs={messages}
  onRestore={handleRestore}
/>
        <div style={s.uploadSection}>
          <NamespaceSelector value={namespace} onChange={setNamespace} />
          <div style={{ ...s.dropZone, ...(dragOver ? s.dropZoneActive : {}) }}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); uploadFile(e.dataTransfer.files[0]); }}
            onClick={() => fileRef.current?.click()}>
            <input ref={fileRef} type="file" accept=".pdf,.docx,.txt" style={{ display: "none" }}
              onChange={e => uploadFile(e.target.files[0])} />
            {uploading
              ? <><div style={s.spinner} /><span style={s.dropText}>Indexing...</span></>
              : <><span style={s.dropIcon}>⬆</span><span style={s.dropText}>Drop file or click to upload</span>
                  <span style={s.dropHint}>PDF · DOCX · TXT · max 20MB</span></>
            }
          </div>
        </div>

        <div style={s.statsBar}>
          <span style={s.statLabel}>Indexed sources</span>
          <span style={s.statVal}>{sources.length}</span>
        </div>
      </aside>

      {/* Main */}
      <main style={s.main}>
        {tab === "query" ? (
          <>
            <div ref={chatRef} style={s.chat}>
              {messages.map((m, i) => <MessageBubble key={i} msg={m} />)}
              {loading && (
                <div style={s.thinkingRow}>
                  <div style={s.thinkingDot} />
                  <div style={{ ...s.thinkingDot, animationDelay: "0.15s" }} />
                  <div style={{ ...s.thinkingDot, animationDelay: "0.3s" }} />
                </div>
              )}
            </div>
            <div style={s.inputBar}>
              <NamespaceSelector value={namespace} onChange={setNamespace} compact={true} />
              <input
                style={s.input}
                placeholder={sources.length === 0
                  ? "Upload documents first to start asking questions..."
                  : "Ask anything about your knowledge base..."}
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && submitQuery()}
                disabled={loading || sources.length === 0}
              />
              <button style={{ ...s.sendBtn, ...(loading || !question.trim() ? s.sendBtnDisabled : {}) }}
                onClick={submitQuery} disabled={loading || !question.trim()}>
                Send ↑
              </button>
            </div>
          </>
        ) : tab === "sources" ? (
          <SourcesView sources={sources} onDelete={deleteSource} />
        ) : (
          <ConnectorsView />
        )}
      </main>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0a0e14; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-6px); }
        }
      `}</style>
    </div>
  );
}

function ConnectorsView() {
  const [activeConnector, setActiveConnector] = useState(null);

  const connectors = [
    { id: "notion", icon: "📝", name: "Notion", desc: "Sync pages and databases from your Notion workspace", status: "available" },
    { id: "gdrive", icon: "📂", name: "Google Drive", desc: "Auto-index Docs, PDFs and Sheets from your Drive", status: "available" },
    { id: "slack", icon: "💬", name: "Slack", desc: "Index messages from selected channels in real-time", status: "available" },
  ];

  if (activeConnector === "notion") {
    return (
      <div style={{ flex: 1, overflowY: "auto", background: "#0a0e14" }}>
        <div style={{ padding: "20px 32px 0" }}>
          <button
            onClick={() => setActiveConnector(null)}
            style={{ background: "transparent", border: "1px solid #1a2332", color: "#4a6070", padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontSize: 13, marginBottom: 16 }}
          >
            ← Back to Connectors
          </button>
        </div>
        <NotionConnector />
      </div>
    );
  }

  if (activeConnector === "gdrive") {
  return (
    <div style={{ flex: 1, overflowY: "auto", background: "#0a0e14" }}>
      <div style={{ padding: "20px 32px 0" }}>
        <button
          onClick={() => setActiveConnector(null)}
          style={{ background: "transparent", border: "1px solid #1a2332", color: "#4a6070", padding: "6px 14px", borderRadius: 6, cursor: "pointer", marginBottom: 16 }}
        >
          ← Back to Connectors
        </button>
      </div>
      <GoogleDriveConnector />
    </div>
  );
}

if (activeConnector === "slack") {
  return (
    <div style={{ flex: 1, overflowY: "auto", background: "#0a0e14" }}>
      <div style={{ padding: "20px 32px 0" }}>
        <button
          onClick={() => setActiveConnector(null)}
          style={{ background: "transparent", border: "1px solid #1a2332", color: "#4a6070", padding: "6px 14px", borderRadius: 6, cursor: "pointer", marginBottom: 16 }}
        >
          ← Back to Connectors
        </button>
      </div>
      <SlackConnector />
    </div>
  );
}

  return (
    <div style={{ padding: "32px", overflowY: "auto", flex: 1 }}>
      <div style={{ fontSize: 18, fontWeight: 600, color: "#fff", marginBottom: 8 }}>Connectors</div>
      <div style={{ fontSize: 13, color: "#3a5068", marginBottom: 24 }}>
        Automatically sync content from your tools into the knowledge base.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {connectors.map(c => (
          <div key={c.id} style={{
            display: "flex", alignItems: "center", gap: 16,
            background: "#0d1117", border: "1px solid #1a2332",
            borderRadius: 10, padding: "18px 20px",
            opacity: c.status === "coming_soon" ? 0.5 : 1,
          }}>
            <span style={{ fontSize: 28 }}>{c.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>{c.name}</div>
              <div style={{ fontSize: 12, color: "#3a5068", marginTop: 2 }}>{c.desc}</div>
            </div>
            {c.status === "coming_soon" ? (
              <span style={{ fontSize: 11, color: "#3a5068", border: "1px solid #1a2332", borderRadius: 10, padding: "3px 10px" }}>
                Coming Soon
              </span>
            ) : (
              <button
                onClick={() => setActiveConnector(c.id)}
                style={{
                  padding: "7px 18px", background: "rgba(0,229,255,0.1)",
                  border: "1px solid rgba(0,229,255,0.3)", borderRadius: 8,
                  color: "#00e5ff", cursor: "pointer", fontSize: 13, fontWeight: 500,
                }}
              >
                Configure
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ msg }) {
  const isUser = msg.role === "user";
  const isAssistant = msg.role === "assistant";
  const isError = msg.role === "system-error";
  const isSuccess = msg.role === "system-success";

  if (!isUser && !isAssistant) {
    return (
      <div style={{ ...s.systemMsg, ...(isError ? s.systemMsgError : isSuccess ? s.systemMsgSuccess : {}) }}>
        {msg.text}
      </div>
    );
  }

  return (
    <div style={{ ...s.msgRow, ...(isUser ? s.msgRowUser : {}) }}>
      {!isUser && <div style={s.avatar}>⬡</div>}
      <div style={{ ...s.bubble, ...(isUser ? s.bubbleUser : s.bubbleAssistant) }}>
        <div style={s.bubbleText}>{msg.text}</div>
        {isAssistant && msg.sources?.length > 0 && (
          <div style={s.sources}>
            <div style={s.sourcesLabel}>Sources used</div>
            {msg.sources.map((src, i) => (
              <div key={i} style={s.sourceChip}>
                <span style={s.sourceIcon}>📄</span>
                <span style={s.sourceName}>{src.source_name}</span>
                <span style={s.sourceScore}>{Math.round(src.relevance_score * 100)}%</span>
              </div>
            ))}
          </div>
        )}
        {isAssistant && (
          <div style={s.bubbleMeta}>
            {msg.chunks_used} chunks · {msg.model} · {msg.latency_ms ? `${msg.latency_ms}ms` : ""}
          </div>
        )}
      </div>
    </div>
  );
}

function SourcesView({ sources, onDelete }) {
  if (sources.length === 0) {
    return (
      <div style={s.emptyState}>
        <div style={s.emptyIcon}>📂</div>
        <div style={s.emptyTitle}>No documents indexed yet</div>
        <div style={s.emptyDesc}>Upload PDF, DOCX, or TXT files from the sidebar to build your knowledge base.</div>
      </div>
    );
  }
  return (
    <div style={s.sourcesPage}>
      <div style={s.sourcesPageTitle}>Indexed Sources <span style={s.sourcesCount}>{sources.length}</span></div>
      <div style={s.sourcesList}>
        {sources.map(src => (
          <div key={src.source_id} style={s.sourceRow}>
            <span style={s.sourceRowIcon}>{src.file_type === "pdf" ? "📕" : src.file_type === "docx" ? "📘" : "📄"}</span>
            <div style={s.sourceRowInfo}>
              <div style={s.sourceRowName}>{src.name}</div>
              <div style={s.sourceRowMeta}>
                {src.chunk_count} chunks · {src.file_type?.toUpperCase()} · {new Date(src.indexed_at).toLocaleDateString()}
              </div>
            </div>
            <button style={s.deleteBtn} onClick={() => onDelete(src.source_id)}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}

const s = {
  root: { display: "flex", height: "100vh", fontFamily: "'Inter', sans-serif", background: "#0a0e14", color: "#d4dbe8" },
  sidebar: { width: 260, background: "#0d1117", borderRight: "1px solid #1a2332", display: "flex", flexDirection: "column", padding: "20px 16px", gap: 16, flexShrink: 0 },
  logo: { display: "flex", alignItems: "center", gap: 10, padding: "8px 0 16px" },
  logoIcon: { fontSize: 28, color: "#00e5ff" },
  logoTitle: { fontSize: 14, fontWeight: 600, color: "#fff" },
  logoSub: { fontSize: 10, color: "#3a5068", fontFamily: "'JetBrains Mono', monospace", marginTop: 1 },
  nav: { display: "flex", flexDirection: "column", gap: 4 },
  navBtn: { display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 6, border: "none", background: "transparent", color: "#4a6070", cursor: "pointer", fontSize: 13, fontFamily: "'Inter', sans-serif", textAlign: "left" },
  navBtnActive: { background: "rgba(0,229,255,0.08)", color: "#00e5ff", fontWeight: 500 },
  uploadSection: { marginTop: "auto" },
  dropZone: { border: "1px dashed #1e2d3d", borderRadius: 8, padding: "20px 12px", textAlign: "center", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, transition: "all 0.2s" },
  dropZoneActive: { border: "1px dashed #00e5ff", background: "rgba(0,229,255,0.04)" },
  dropIcon: { fontSize: 20, color: "#3a5068" },
  dropText: { fontSize: 12, color: "#4a6070" },
  dropHint: { fontSize: 10, color: "#2a3d50", fontFamily: "'JetBrains Mono', monospace" },
  spinner: { width: 18, height: 18, border: "2px solid #1e2d3d", borderTop: "2px solid #00e5ff", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  statsBar: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: "1px solid #1a2332" },
  statLabel: { fontSize: 11, color: "#3a5068", fontFamily: "'JetBrains Mono', monospace" },
  statVal: { fontSize: 14, fontWeight: 600, color: "#00e5ff" },
  main: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
  chat: { flex: 1, overflowY: "auto", padding: "24px 32px", display: "flex", flexDirection: "column", gap: 16 },
  msgRow: { display: "flex", alignItems: "flex-start", gap: 12 },
  msgRowUser: { flexDirection: "row-reverse" },
  avatar: { width: 32, height: 32, borderRadius: "50%", background: "rgba(0,229,255,0.1)", border: "1px solid rgba(0,229,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 },
  bubble: { maxWidth: "72%", borderRadius: 12, padding: "12px 16px" },
  bubbleUser: { background: "rgba(0,229,255,0.1)", border: "1px solid rgba(0,229,255,0.15)", borderTopRightRadius: 2 },
  bubbleAssistant: { background: "#0d1117", border: "1px solid #1a2332", borderTopLeftRadius: 2 },
  bubbleText: { fontSize: 14, lineHeight: 1.6, color: "#d4dbe8", whiteSpace: "pre-wrap" },
  bubbleMeta: { marginTop: 8, fontSize: 10, color: "#3a5068", fontFamily: "'JetBrains Mono', monospace" },
  sources: { marginTop: 12, paddingTop: 12, borderTop: "1px solid #1a2332" },
  sourcesLabel: { fontSize: 10, color: "#3a5068", fontFamily: "'JetBrains Mono', monospace", marginBottom: 8, letterSpacing: "0.1em", textTransform: "uppercase" },
  sourceChip: { display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: "#131920", borderRadius: 6, marginBottom: 4 },
  sourceIcon: { fontSize: 12 },
  sourceName: { flex: 1, fontSize: 11, color: "#7a9ab5", fontFamily: "'JetBrains Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  sourceScore: { fontSize: 10, color: "#00e5ff", fontFamily: "'JetBrains Mono', monospace" },
  systemMsg: { alignSelf: "center", fontSize: 11, color: "#3a5068", fontFamily: "'JetBrains Mono', monospace", background: "#0d1117", border: "1px solid #1a2332", borderRadius: 6, padding: "6px 14px" },
  systemMsgError: { color: "#ff6b6b", borderColor: "rgba(255,107,107,0.2)", background: "rgba(255,107,107,0.05)" },
  systemMsgSuccess: { color: "#00ff9d", borderColor: "rgba(0,255,157,0.2)", background: "rgba(0,255,157,0.05)" },
  thinkingRow: { display: "flex", gap: 5, padding: "8px 44px", alignItems: "center" },
  thinkingDot: { width: 7, height: 7, borderRadius: "50%", background: "#00e5ff", opacity: 0.6, animation: "bounce 1s ease infinite" },
  inputBar: { padding: "16px 32px 24px", display: "flex", gap: 10, borderTop: "1px solid #1a2332", background: "#0a0e14" },
  input: { flex: 1, background: "#0d1117", border: "1px solid #1a2332", borderRadius: 10, padding: "12px 16px", color: "#d4dbe8", fontSize: 14, fontFamily: "'Inter', sans-serif", outline: "none" },
  sendBtn: { padding: "12px 20px", background: "rgba(0,229,255,0.12)", border: "1px solid rgba(0,229,255,0.3)", borderRadius: 10, color: "#00e5ff", cursor: "pointer", fontSize: 13, fontWeight: 500, fontFamily: "'Inter', sans-serif", whiteSpace: "nowrap" },
  sendBtnDisabled: { opacity: 0.3, cursor: "not-allowed" },
  emptyState: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "#3a5068" },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 16, fontWeight: 600, color: "#4a6070" },
  emptyDesc: { fontSize: 13, color: "#3a5068", textAlign: "center", maxWidth: 340, lineHeight: 1.6 },
  sourcesPage: { padding: "32px", overflowY: "auto", flex: 1 },
  sourcesPageTitle: { fontSize: 18, fontWeight: 600, color: "#fff", marginBottom: 20, display: "flex", alignItems: "center", gap: 12 },
  sourcesCount: { fontSize: 12, background: "rgba(0,229,255,0.1)", color: "#00e5ff", border: "1px solid rgba(0,229,255,0.2)", borderRadius: 10, padding: "2px 10px" },
  sourcesList: { display: "flex", flexDirection: "column", gap: 10 },
  sourceRow: { display: "flex", alignItems: "center", gap: 14, background: "#0d1117", border: "1px solid #1a2332", borderRadius: 8, padding: "14px 16px" },
  sourceRowIcon: { fontSize: 22 },
  sourceRowInfo: { flex: 1 },
  sourceRowName: { fontSize: 13, fontWeight: 500, color: "#d4dbe8" },
  sourceRowMeta: { fontSize: 11, color: "#3a5068", fontFamily: "'JetBrains Mono', monospace", marginTop: 4 },
  deleteBtn: { padding: "6px 14px", background: "transparent", border: "1px solid #1e2d3d", borderRadius: 6, color: "#4a6070", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif" },
};