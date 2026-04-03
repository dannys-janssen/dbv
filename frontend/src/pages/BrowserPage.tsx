import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  getDatabases,
  getCollections,
  getDocuments,
  deleteDocument,
  exportCollection,
  importCollection,
  aggregate,
  createDocument,
  updateDocument,
} from "../api/mongo";
import { useAuth } from "../context/AuthContext";
import Editor from "@monaco-editor/react";

type View = "documents" | "aggregate";

export default function BrowserPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [databases, setDatabases] = useState<string[]>([]);
  const [collections, setCollections] = useState<string[]>([]);
  const [selectedDb, setSelectedDb] = useState("");
  const [selectedCol, setSelectedCol] = useState("");

  const [view, setView] = useState<View>("documents");
  const [documents, setDocuments] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filterText, setFilterText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Editor modal
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorValue, setEditorValue] = useState("{}");
  const [editingId, setEditingId] = useState<string | null>(null);

  // Aggregate
  const [pipeline, setPipeline] = useState("[]");
  const [aggResults, setAggResults] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    getDatabases()
      .then((d) => setDatabases(d.databases))
      .catch(() => { logout(); navigate("/login"); });
  }, []);

  useEffect(() => {
    if (!selectedDb) return;
    getCollections(selectedDb).then((c) => {
      setCollections(c.collections);
      setSelectedCol("");
      setDocuments([]);
    });
  }, [selectedDb]);

  const loadDocuments = useCallback(() => {
    if (!selectedDb || !selectedCol) return;
    setLoading(true);
    setError("");
    getDocuments(selectedDb, selectedCol, page, 20, filterText || undefined)
      .then((r) => { setDocuments(r.documents); setTotal(r.total); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectedDb, selectedCol, page, filterText]);

  useEffect(() => { loadDocuments(); }, [loadDocuments]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this document?")) return;
    await deleteDocument(selectedDb, selectedCol, id);
    loadDocuments();
  };

  const openCreate = () => {
    setEditingId(null);
    setEditorValue("{}");
    setEditorOpen(true);
  };

  const openEdit = (doc: Record<string, unknown>) => {
    const id = getDocId(doc);
    setEditingId(id);
    setEditorValue(JSON.stringify(doc, null, 2));
    setEditorOpen(true);
  };

  const handleSave = async () => {
    try {
      const parsed = JSON.parse(editorValue);
      if (editingId) {
        await updateDocument(selectedDb, selectedCol, editingId, parsed);
      } else {
        await createDocument(selectedDb, selectedCol, parsed);
      }
      setEditorOpen(false);
      loadDocuments();
    } catch (e: unknown) {
      alert("Invalid JSON or save failed: " + (e as Error).message);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const docs = JSON.parse(text);
    if (!confirm(`Import ${docs.length} documents? (replace existing?)`)) return;
    await importCollection(selectedDb, selectedCol, docs, true);
    loadDocuments();
  };

  const runAggregate = async () => {
    try {
      const p = JSON.parse(pipeline);
      const r = await aggregate(selectedDb, selectedCol, p);
      setAggResults(r.results);
    } catch (e: unknown) {
      alert("Error: " + (e as Error).message);
    }
  };

  const getDocId = (doc: Record<string, unknown>): string => {
    const id = doc["_id"] as Record<string, unknown> | string | undefined;
    if (typeof id === "object" && id !== null) return (id as Record<string, unknown>)["$oid"] as string;
    return String(id ?? "");
  };

  return (
    <div style={styles.layout}>
      {/* Sidebar */}
      <aside style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
          <span style={{ fontWeight: "bold" }}>dbv</span>
          <button onClick={() => { logout(); navigate("/login"); }} style={styles.logoutBtn}>
            Sign out
          </button>
        </div>
        <div style={styles.section}>
          <label style={styles.label}>Database</label>
          <select style={styles.select} value={selectedDb} onChange={(e) => setSelectedDb(e.target.value)}>
            <option value="">— select —</option>
            {databases.map((db) => <option key={db}>{db}</option>)}
          </select>
        </div>
        {selectedDb && (
          <div style={styles.section}>
            <label style={styles.label}>Collection</label>
            <ul style={styles.list}>
              {collections.map((c) => (
                <li
                  key={c}
                  style={{ ...styles.listItem, background: c === selectedCol ? "#dbeafe" : undefined }}
                  onClick={() => { setSelectedCol(c); setPage(1); }}
                >
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>

      {/* Main content */}
      <main style={styles.main}>
        {selectedCol ? (
          <>
            <div style={styles.toolbar}>
              <h2 style={{ margin: 0 }}>{selectedDb} / {selectedCol}</h2>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button style={styles.btn} onClick={() => setView("documents")}>Documents</button>
                <button style={styles.btn} onClick={() => setView("aggregate")}>Aggregate</button>
                <button style={styles.btn} onClick={openCreate}>+ New</button>
                <button style={styles.btn} onClick={() => exportCollection(selectedDb, selectedCol)}>Export</button>
                <label style={styles.btn}>
                  Import
                  <input type="file" accept=".json" style={{ display: "none" }} onChange={handleImport} />
                </label>
              </div>
            </div>

            {view === "documents" && (
              <>
                <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
                  <input
                    style={styles.input}
                    placeholder='Filter (JSON, e.g. {"name":"test"})'
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && loadDocuments()}
                  />
                  <button style={styles.btn} onClick={loadDocuments}>Apply</button>
                </div>

                {error && <p style={{ color: "red" }}>{error}</p>}
                {loading ? <p>Loading…</p> : (
                  <>
                    <p style={{ color: "#666", fontSize: "0.85rem" }}>{total} documents total</p>
                    <div style={styles.docGrid}>
                      {documents.map((doc) => {
                        const id = getDocId(doc);
                        return (
                          <div key={id} style={styles.docCard}>
                            <pre style={styles.docPre}>{JSON.stringify(doc, null, 2)}</pre>
                            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                              <button style={styles.smallBtn} onClick={() => openEdit(doc)}>Edit</button>
                              <button style={{ ...styles.smallBtn, background: "#fee2e2" }} onClick={() => handleDelete(id)}>Delete</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                      <button style={styles.btn} disabled={page === 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
                      <span>Page {page}</span>
                      <button style={styles.btn} disabled={documents.length < 20} onClick={() => setPage((p) => p + 1)}>Next →</button>
                    </div>
                  </>
                )}
              </>
            )}

            {view === "aggregate" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <p style={{ margin: 0, color: "#666", fontSize: "0.85rem" }}>Enter an aggregation pipeline (JSON array):</p>
                <Editor height="200px" defaultLanguage="json" value={pipeline} onChange={(v) => setPipeline(v ?? "[]")} />
                <button style={styles.btn} onClick={runAggregate}>Run</button>
                {aggResults.length > 0 && (
                  <pre style={styles.docPre}>{JSON.stringify(aggResults, null, 2)}</pre>
                )}
              </div>
            )}
          </>
        ) : (
          <div style={{ color: "#999", marginTop: "4rem", textAlign: "center" }}>
            Select a database and collection to get started.
          </div>
        )}
      </main>

      {/* Editor modal */}
      {editorOpen && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <h3>{editingId ? "Edit Document" : "New Document"}</h3>
            <Editor
              height="400px"
              defaultLanguage="json"
              value={editorValue}
              onChange={(v) => setEditorValue(v ?? "{}")}
            />
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", justifyContent: "flex-end" }}>
              <button style={styles.btn} onClick={() => setEditorOpen(false)}>Cancel</button>
              <button style={{ ...styles.btn, background: "#1a73e8", color: "#fff" }} onClick={handleSave}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  layout: { display: "flex", height: "100vh", fontFamily: "sans-serif" },
  sidebar: { width: "240px", borderRight: "1px solid #e5e7eb", display: "flex", flexDirection: "column", overflowY: "auto" },
  sidebarHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem", borderBottom: "1px solid #e5e7eb" },
  logoutBtn: { background: "none", border: "none", cursor: "pointer", color: "#888", fontSize: "0.8rem" },
  section: { padding: "1rem" },
  label: { display: "block", fontSize: "0.75rem", color: "#666", marginBottom: "0.4rem", textTransform: "uppercase" },
  select: { width: "100%", padding: "0.4rem", borderRadius: "4px", border: "1px solid #ddd" },
  list: { listStyle: "none", padding: 0, margin: 0 },
  listItem: { padding: "0.4rem 0.5rem", borderRadius: "4px", cursor: "pointer" },
  main: { flex: 1, padding: "1.5rem", overflowY: "auto" },
  toolbar: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" },
  btn: { padding: "0.4rem 0.8rem", borderRadius: "4px", border: "1px solid #ddd", background: "#f9fafb", cursor: "pointer" },
  smallBtn: { padding: "0.25rem 0.6rem", borderRadius: "4px", border: "1px solid #ddd", background: "#f9fafb", cursor: "pointer", fontSize: "0.8rem" },
  input: { flex: 1, padding: "0.4rem 0.8rem", border: "1px solid #ddd", borderRadius: "4px", fontFamily: "monospace" },
  docGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1rem" },
  docCard: { border: "1px solid #e5e7eb", borderRadius: "6px", padding: "0.75rem", background: "#fafafa" },
  docPre: { fontSize: "0.75rem", overflow: "auto", maxHeight: "200px", margin: 0, whiteSpace: "pre-wrap" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 },
  modal: { background: "#fff", borderRadius: "8px", padding: "1.5rem", width: "600px", boxShadow: "0 8px 30px rgba(0,0,0,0.2)" },
};
