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
  getSchema,
  createDatabase,
  dropDatabase,
  createCollection,
  dropCollection,
  type CollectionSchema,
} from "../api/mongo";
import { useAuth } from "../context/AuthContext";
import Editor from "@monaco-editor/react";
import SchemaViewer from "../components/SchemaViewer";

type View = "documents" | "aggregate" | "schema";

export default function BrowserPage() {
  const { logout, canWrite, roles } = useAuth();
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

  // Schema
  const [schema, setSchema] = useState<CollectionSchema | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);

  // Create/Drop dialogs
  const [newDbName, setNewDbName] = useState("");
  const [newDbCollection, setNewDbCollection] = useState("");
  const [newDbOpen, setNewDbOpen] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [newColOpen, setNewColOpen] = useState(false);

  const reloadDatabases = useCallback(() => {
    getDatabases()
      .then((d) => setDatabases(d.databases))
      .catch(() => { logout(); navigate("/login"); });
  }, [logout, navigate]);

  const reloadCollections = useCallback(() => {
    if (!selectedDb) return;
    getCollections(selectedDb)
      .then((c) => setCollections(c.collections))
      .catch((e) => setError(`Failed to load collections: ${e.message}`));
  }, [selectedDb]);

  const handleCreateDb = async () => {
    if (!newDbName.trim() || !newDbCollection.trim()) return;
    try {
      await createDatabase(newDbName.trim(), newDbCollection.trim());
      setNewDbOpen(false);
      setNewDbName("");
      setNewDbCollection("");
      reloadDatabases();
      setSelectedDb(newDbName.trim());
    } catch (e: unknown) { alert("Error: " + (e as Error).message); }
  };

  const handleDropDb = async () => {
    if (!selectedDb) return;
    if (!confirm(`Drop entire database "${selectedDb}"? This cannot be undone.`)) return;
    try {
      await dropDatabase(selectedDb);
      setSelectedDb("");
      setCollections([]);
      reloadDatabases();
    } catch (e: unknown) { alert("Error: " + (e as Error).message); }
  };

  const handleCreateCollection = async () => {
    if (!newColName.trim()) return;
    try {
      await createCollection(selectedDb, newColName.trim());
      setNewColOpen(false);
      setNewColName("");
      reloadCollections();
    } catch (e: unknown) { alert("Error: " + (e as Error).message); }
  };

  const handleDropCollection = async (col: string) => {
    if (!confirm(`Drop collection "${col}"? All documents will be deleted.`)) return;
    try {
      await dropCollection(selectedDb, col);
      if (col === selectedCol) { setSelectedCol(""); setDocuments([]); }
      reloadCollections();
    } catch (e: unknown) { alert("Error: " + (e as Error).message); }
  };

  useEffect(() => {
    reloadDatabases();
  }, [reloadDatabases]);

  useEffect(() => {
    if (!selectedDb) return;
    getCollections(selectedDb)
      .then((c) => {
        setCollections(c.collections);
        setSelectedCol("");
        setDocuments([]);
        setSchema(null);
      })
      .catch((e) => setError(`Failed to load collections: ${e.message}`));
  }, [selectedDb]);

  const loadSchema = useCallback(() => {
    if (!selectedDb || !selectedCol) return;
    setSchemaLoading(true);
    getSchema(selectedDb, selectedCol)
      .then(setSchema)
      .catch(() => setSchema(null))
      .finally(() => setSchemaLoading(false));
  }, [selectedDb, selectedCol]);

  useEffect(() => {
    if (view === "schema") loadSchema();
  }, [view, loadSchema]);

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
          <div style={styles.sectionHeader}>
            <label style={styles.label}>Database</label>
            {canWrite && (
              <button style={styles.iconBtn} title="Create database" onClick={() => setNewDbOpen(true)}>＋</button>
            )}
          </div>
          <div style={{ display: "flex", gap: "0.25rem" }}>
            <select style={{ ...styles.select, flex: 1 }} value={selectedDb} onChange={(e) => setSelectedDb(e.target.value)}>
              <option value="">— select —</option>
              {databases.map((db) => <option key={db}>{db}</option>)}
            </select>
            {canWrite && selectedDb && !["admin","config","local"].includes(selectedDb) && (
              <button style={styles.dangerIconBtn} title={`Drop database "${selectedDb}"`} onClick={handleDropDb}>🗑</button>
            )}
          </div>
        </div>
        {selectedDb && (
          <div style={styles.section}>
            <div style={styles.sectionHeader}>
              <label style={styles.label}>Collection</label>
              {canWrite && (
                <button style={styles.iconBtn} title="Create collection" onClick={() => setNewColOpen(true)}>＋</button>
              )}
            </div>
            {collections.length === 0 ? (
              <p style={{ fontSize: "0.8rem", color: "#9ca3af", margin: 0 }}>
                No collections found.{"\n"}
                {canWrite
                  ? 'Click ＋ to create one, or import data.'
                  : "Ask an admin to create collections."}
              </p>
            ) : (
              <ul style={styles.list}>
                {collections.map((c) => (
                  <li
                    key={c}
                    style={{ ...styles.listItem, background: c === selectedCol ? "#dbeafe" : undefined, display: "flex", justifyContent: "space-between", alignItems: "center" }}
                    onClick={() => { setSelectedCol(c); setPage(1); }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c}</span>
                    {canWrite && (
                      <button
                        style={styles.inlineDeleteBtn}
                        title={`Drop collection "${c}"`}
                        onClick={(e) => { e.stopPropagation(); handleDropCollection(c); }}
                      >✕</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </aside>

      {/* Main content */}
      <main style={styles.main}>
        {selectedCol ? (
          <>
            <div style={styles.toolbar}>
              <div>
                <h2 style={{ margin: 0 }}>{selectedDb} / {selectedCol}</h2>
                <span style={styles.roleTag}>
                  {canWrite ? "✏️ admin" : "👁 viewer"}
                  {roles.length === 0 && " (no roles — check Keycloak config)"}
                </span>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button style={activeBtn(view === "documents")} onClick={() => setView("documents")}>Documents</button>
                <button style={activeBtn(view === "aggregate")} onClick={() => setView("aggregate")}>Aggregate</button>
                <button style={activeBtn(view === "schema")} onClick={() => setView("schema")}>Schema</button>
                {canWrite && <button style={styles.btn} onClick={openCreate}>+ New</button>}
                <button style={styles.btn} onClick={() => exportCollection(selectedDb, selectedCol)}>Export</button>
                {canWrite && (
                  <label style={styles.btn}>
                    Import
                    <input type="file" accept=".json" style={{ display: "none" }} onChange={handleImport} />
                  </label>
                )}
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
                            {canWrite && (
                              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                                <button style={styles.smallBtn} onClick={() => openEdit(doc)}>Edit</button>
                                <button style={{ ...styles.smallBtn, background: "#fee2e2" }} onClick={() => handleDelete(id)}>Delete</button>
                              </div>
                            )}
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

            {view === "schema" && (
              schemaLoading ? <p>Inferring schema…</p> :
              schema ? <SchemaViewer fields={schema.fields} sampledDocs={schema.sampled_documents} /> :
              <p style={{ color: "#999" }}>No schema data available.</p>
            )}
          </>
        ) : (
          <div style={{ padding: "4rem 2rem", textAlign: "center" }}>
            <p style={{ color: "#6b7280", fontSize: "1rem", marginBottom: "0.5rem" }}>
              {selectedDb
                ? "Select a collection from the sidebar to browse data."
                : "Select a database from the sidebar to get started."}
            </p>
            {selectedDb && collections.length === 0 && (
              <p style={{ color: "#9ca3af", fontSize: "0.85rem" }}>
                <strong>{selectedDb}</strong> has no collections yet.{" "}
                {["admin", "config", "local"].includes(selectedDb) &&
                  "This is a MongoDB system database — consider creating your own database instead."}
              </p>
            )}
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
      {/* Create Database modal */}
      {newDbOpen && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <h3>Create Database</h3>
            <p style={{ fontSize: "0.85rem", color: "#6b7280" }}>
              MongoDB creates a database when its first collection is created.
            </p>
            <label style={styles.label}>Database name</label>
            <input style={{ ...styles.input, width: "100%", marginBottom: "0.75rem", boxSizing: "border-box" }}
              placeholder="e.g. myapp" value={newDbName} onChange={(e) => setNewDbName(e.target.value)} />
            <label style={styles.label}>Initial collection name</label>
            <input style={{ ...styles.input, width: "100%", boxSizing: "border-box" }}
              placeholder="e.g. users" value={newDbCollection} onChange={(e) => setNewDbCollection(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateDb()} />
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", justifyContent: "flex-end" }}>
              <button style={styles.btn} onClick={() => setNewDbOpen(false)}>Cancel</button>
              <button style={{ ...styles.btn, background: "#1a73e8", color: "#fff" }} onClick={handleCreateDb}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Create Collection modal */}
      {newColOpen && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <h3>Create Collection in <em>{selectedDb}</em></h3>
            <label style={styles.label}>Collection name</label>
            <input style={{ ...styles.input, width: "100%", boxSizing: "border-box" }}
              placeholder="e.g. products" value={newColName} onChange={(e) => setNewColName(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleCreateCollection()} />
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", justifyContent: "flex-end" }}>
              <button style={styles.btn} onClick={() => setNewColOpen(false)}>Cancel</button>
              <button style={{ ...styles.btn, background: "#1a73e8", color: "#fff" }} onClick={handleCreateCollection}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const activeBtn = (active: boolean): React.CSSProperties => ({
  padding: "0.4rem 0.8rem",
  borderRadius: "4px",
  border: "1px solid #ddd",
  background: active ? "#1a73e8" : "#f9fafb",
  color: active ? "#fff" : "inherit",
  cursor: "pointer",
  fontWeight: active ? 600 : undefined,
});

const styles: Record<string, React.CSSProperties> = {
  layout: { display: "flex", height: "100vh", fontFamily: "sans-serif" },
  sidebar: { width: "240px", borderRight: "1px solid #e5e7eb", display: "flex", flexDirection: "column", overflowY: "auto" },
  sidebarHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem", borderBottom: "1px solid #e5e7eb" },
  logoutBtn: { background: "none", border: "none", cursor: "pointer", color: "#888", fontSize: "0.8rem" },
  section: { padding: "1rem" },
  sectionHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" },
  label: { display: "block", fontSize: "0.75rem", color: "#666", textTransform: "uppercase" },
  select: { width: "100%", padding: "0.4rem", borderRadius: "4px", border: "1px solid #ddd" },
  list: { listStyle: "none", padding: 0, margin: 0 },
  listItem: { padding: "0.4rem 0.5rem", borderRadius: "4px", cursor: "pointer" },
  iconBtn: { background: "none", border: "none", cursor: "pointer", color: "#1a73e8", fontSize: "1rem", lineHeight: 1, padding: "0 2px" },
  dangerIconBtn: { background: "none", border: "1px solid #fca5a5", borderRadius: "4px", cursor: "pointer", color: "#ef4444", fontSize: "0.85rem", padding: "0.2rem 0.4rem" },
  inlineDeleteBtn: { background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: "0.7rem", padding: "0 2px", flexShrink: 0 },
  main: { flex: 1, padding: "1.5rem", overflowY: "auto" },
  toolbar: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem", flexWrap: "wrap", gap: "0.75rem" },
  roleTag: { fontSize: "0.75rem", color: "#6b7280", marginTop: "0.2rem", display: "block" },
  btn: { padding: "0.4rem 0.8rem", borderRadius: "4px", border: "1px solid #ddd", background: "#f9fafb", cursor: "pointer" },
  smallBtn: { padding: "0.25rem 0.6rem", borderRadius: "4px", border: "1px solid #ddd", background: "#f9fafb", cursor: "pointer", fontSize: "0.8rem" },
  input: { flex: 1, padding: "0.4rem 0.8rem", border: "1px solid #ddd", borderRadius: "4px", fontFamily: "monospace" },
  docGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1rem" },
  docCard: { border: "1px solid #e5e7eb", borderRadius: "6px", padding: "0.75rem", background: "#fafafa" },
  docPre: { fontSize: "0.75rem", overflow: "auto", maxHeight: "200px", margin: 0, whiteSpace: "pre-wrap" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 },
  modal: { background: "#fff", borderRadius: "8px", padding: "1.5rem", width: "600px", maxWidth: "90vw", boxShadow: "0 8px 30px rgba(0,0,0,0.2)" },
};
