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
  listIndexes,
  createIndex,
  dropIndex,
  type CollectionSchema,
  type IndexInfo,
  type IndexKey,
} from "../api/mongo";
import { useAuth } from "../context/AuthContext";
import Editor from "@monaco-editor/react";
import SchemaViewer from "../components/SchemaViewer";

type View = "documents" | "aggregate" | "schema" | "indexes";

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

function previewDoc(doc: Record<string, unknown>): string {
  const entries = Object.entries(doc)
    .filter(([k]) => k !== "_id")
    .map(([k, v]) => {
      const val = typeof v === "object" && v !== null ? "{…}" : String(v);
      return `${k}: ${val}`;
    });
  const preview = entries.join("  ·  ");
  return preview.length > 120 ? preview.slice(0, 120) + "…" : preview;
}

// --- Shared modal styles ---
const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
};

const modalBaseStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: "12px",
  padding: "24px",
  width: "480px",
  maxWidth: "90vw",
  boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
  fontFamily: FONT,
};

const modalTitleStyle: React.CSSProperties = {
  fontSize: "16px",
  fontWeight: 700,
  color: "#0f172a",
  margin: "0 0 4px 0",
  fontFamily: FONT,
};

const modalSubtitleStyle: React.CSSProperties = {
  fontSize: "13px",
  color: "#64748b",
  margin: "0 0 20px 0",
  fontFamily: FONT,
};

const modalLabelStyle: React.CSSProperties = {
  fontSize: "12px",
  fontWeight: 600,
  color: "#374151",
  marginBottom: "6px",
  display: "block",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  fontFamily: FONT,
};

const modalInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #e2e8f0",
  borderRadius: "8px",
  fontSize: "14px",
  boxSizing: "border-box",
  marginBottom: "16px",
  fontFamily: FONT,
  outline: "none",
};

const modalFooterStyle: React.CSSProperties = {
  display: "flex",
  gap: "8px",
  justifyContent: "flex-end",
  marginTop: "8px",
};

const cancelBtnStyle: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  color: "#374151",
  padding: "8px 16px",
  borderRadius: "6px",
  cursor: "pointer",
  fontSize: "14px",
  fontFamily: FONT,
};

const primaryBtnStyle: React.CSSProperties = {
  background: "#2563eb",
  color: "#ffffff",
  border: "none",
  padding: "8px 16px",
  borderRadius: "6px",
  cursor: "pointer",
  fontSize: "14px",
  fontWeight: 600,
  fontFamily: FONT,
};

const sidebarSearchStyle: React.CSSProperties = {
  width: "100%",
  fontSize: "10px",
  padding: "6px 8px",
  background: "#243044",
  border: "1px solid #2d3f5e",
  color: "#e2e8f0",
  borderRadius: "6px",
  boxSizing: "border-box",
  marginBottom: "8px",
  fontFamily: FONT,
  outline: "none",
};

const sectionLabelStyle: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: "10px",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontFamily: FONT,
};

export default function BrowserPage() {
  const { logout, canWrite } = useAuth();
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
  const [sortText, setSortText] = useState("");
  const [limitVal, setLimitVal] = useState(20);
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

  // Indexes
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [indexesLoading, setIndexesLoading] = useState(false);
  const [newIndexOpen, setNewIndexOpen] = useState(false);
  const [indexKeys, setIndexKeys] = useState<IndexKey[]>([{ field: "", direction: 1 }]);
  const [indexName, setIndexName] = useState("");
  const [indexUnique, setIndexUnique] = useState(false);
  const [indexSparse, setIndexSparse] = useState(false);
  const [indexBackground, setIndexBackground] = useState(true);
  const [indexTtl, setIndexTtl] = useState("");

  // Create/Drop dialogs
  const [newDbName, setNewDbName] = useState("");
  const [newDbCollection, setNewDbCollection] = useState("");
  const [newDbOpen, setNewDbOpen] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [newColOpen, setNewColOpen] = useState(false);

  // Sidebar search filters
  const [dbSearch, setDbSearch] = useState("");
  const [colSearch, setColSearch] = useState("");

  // Hover states for sidebar items
  const [hoveredDb, setHoveredDb] = useState<string | null>(null);
  const [hoveredCol, setHoveredCol] = useState<string | null>(null);

  const reloadDatabases = useCallback(() => {
    getDatabases()
      .then((d) => setDatabases(d.databases))
      .catch(() => {
        logout();
        navigate("/login");
      });
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
    } catch (e: unknown) {
      alert("Error: " + (e as Error).message);
    }
  };

  const handleDropDb = async () => {
    if (!selectedDb) return;
    if (!confirm(`Drop entire database "${selectedDb}"? This cannot be undone.`)) return;
    try {
      await dropDatabase(selectedDb);
      setSelectedDb("");
      setCollections([]);
      reloadDatabases();
    } catch (e: unknown) {
      alert("Error: " + (e as Error).message);
    }
  };

  const handleCreateCollection = async () => {
    if (!newColName.trim()) return;
    try {
      await createCollection(selectedDb, newColName.trim());
      setNewColOpen(false);
      setNewColName("");
      reloadCollections();
    } catch (e: unknown) {
      alert("Error: " + (e as Error).message);
    }
  };

  const handleDropCollection = async (col: string) => {
    if (!confirm(`Drop collection "${col}"? All documents will be deleted.`)) return;
    try {
      await dropCollection(selectedDb, col);
      if (col === selectedCol) {
        setSelectedCol("");
        setDocuments([]);
      }
      reloadCollections();
    } catch (e: unknown) {
      alert("Error: " + (e as Error).message);
    }
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
        setFilterText("");
        setSortText("");
        setPage(1);
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

  const loadIndexes = useCallback(() => {
    if (!selectedDb || !selectedCol) return;
    setIndexesLoading(true);
    listIndexes(selectedDb, selectedCol)
      .then((r) => setIndexes(r.indexes))
      .catch(() => setIndexes([]))
      .finally(() => setIndexesLoading(false));
  }, [selectedDb, selectedCol]);

  useEffect(() => {
    if (view === "indexes") loadIndexes();
  }, [view, loadIndexes]);

  const loadDocuments = useCallback(() => {
    if (!selectedDb || !selectedCol) return;
    setLoading(true);
    setError("");
    getDocuments(selectedDb, selectedCol, page, limitVal, filterText || undefined, sortText || undefined)
      .then((r) => {
        setDocuments(r.documents);
        setTotal(r.total);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectedDb, selectedCol, page, limitVal, filterText, sortText]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

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

  const handleSave = useCallback(async () => {
    try {
      const parsed = JSON.parse(editorValue) as Record<string, unknown>;
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
  }, [editorValue, editingId, selectedDb, selectedCol, loadDocuments]);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const docs = JSON.parse(text) as unknown[];
    if (!confirm(`Import ${docs.length} documents? (replace existing?)`)) return;
    await importCollection(selectedDb, selectedCol, docs, true);
    loadDocuments();
  };

  const runAggregate = useCallback(async () => {
    try {
      const p = JSON.parse(pipeline) as unknown[];
      const r = await aggregate(selectedDb, selectedCol, p);
      setAggResults(r.results);
    } catch (e: unknown) {
      alert("Error: " + (e as Error).message);
    }
  }, [pipeline, selectedDb, selectedCol]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // ESC — close any open modal
      if (e.key === "Escape") {
        if (editorOpen)   { setEditorOpen(false);   return; }
        if (newDbOpen)    { setNewDbOpen(false);     return; }
        if (newColOpen)   { setNewColOpen(false);    return; }
        if (newIndexOpen) { setNewIndexOpen(false);  return; }
      }
      // Ctrl+S / Cmd+S — save document editor
      if ((e.ctrlKey || e.metaKey) && e.key === "s" && editorOpen) {
        e.preventDefault();
        void handleSave();
      }
      // Ctrl+Enter / Cmd+Enter — run aggregate pipeline
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && view === "aggregate") {
        e.preventDefault();
        void runAggregate();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editorOpen, newDbOpen, newColOpen, newIndexOpen, view, handleSave, runAggregate]);

  const getDocId = (doc: Record<string, unknown>): string => {
    const id = doc["_id"] as Record<string, unknown> | string | undefined;
    if (typeof id === "object" && id !== null)
      return (id as Record<string, unknown>)["$oid"] as string;
    return String(id ?? "");
  };

  const filteredDatabases = databases.filter((db) =>
    db.toLowerCase().includes(dbSearch.toLowerCase())
  );

  const filteredCollections = collections.filter((col) =>
    col.toLowerCase().includes(colSearch.toLowerCase())
  );

  const limit = 20;
  const startDoc = total > 0 ? (page - 1) * limit + 1 : 0;
  const endDoc = Math.min(page * limit, total);

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        fontFamily: FONT,
        overflow: "hidden",
      }}
    >
      {/* ── Sidebar ── */}
      <aside
        style={{
          width: "260px",
          minWidth: "260px",
          background: "#1a2236",
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          flexShrink: 0,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px",
            borderBottom: "1px solid #243044",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontWeight: "bold",
              color: "#ffffff",
              fontSize: "15px",
              fontFamily: FONT,
            }}
          >
            dbv
          </span>
          <button
            onClick={() => {
              logout();
              navigate("/login");
            }}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#64748b",
              fontSize: "12px",
              fontFamily: FONT,
              padding: "2px 6px",
            }}
          >
            Sign out
          </button>
        </div>

        {/* Database section */}
        <div style={{ padding: "12px 16px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "8px",
            }}
          >
            <span style={sectionLabelStyle}>DATABASES</span>
            {canWrite && (
              <button
                onClick={() => setNewDbOpen(true)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#60a5fa",
                  fontSize: "16px",
                  lineHeight: 1,
                  padding: "0 2px",
                }}
                title="Create database"
              >
                ＋
              </button>
            )}
          </div>
          <input
            value={dbSearch}
            onChange={(e) => setDbSearch(e.target.value)}
            placeholder="Search databases…"
            style={sidebarSearchStyle}
          />
          {filteredDatabases.length === 0 ? (
            <p
              style={{
                color: "#64748b",
                fontSize: "12px",
                fontStyle: "italic",
                padding: "8px 0",
                margin: 0,
                fontFamily: FONT,
              }}
            >
              No databases found
            </p>
          ) : (
            <div>
              {filteredDatabases.map((db) => {
                const isSelected = db === selectedDb;
                const isHovered = hoveredDb === db;
                return (
                  <div
                    key={db}
                    onClick={() => setSelectedDb(db)}
                    onMouseEnter={() => setHoveredDb(db)}
                    onMouseLeave={() => setHoveredDb(null)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "7px 8px",
                      borderRadius: "6px",
                      cursor: "pointer",
                      background: isSelected
                        ? "#2563eb"
                        : isHovered
                        ? "#1e2d47"
                        : "transparent",
                      marginBottom: "2px",
                    }}
                  >
                    <span style={{ fontSize: "12px" }}>🗄</span>
                    <span
                      style={{
                        flex: 1,
                        fontSize: "13px",
                        color: isSelected ? "#ffffff" : "#cbd5e1",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontFamily: FONT,
                      }}
                    >
                      {db}
                    </span>
                    {canWrite && isSelected && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDropDb();
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          color: "#f87171",
                          fontSize: "14px",
                          padding: "0 2px",
                          opacity: 0.8,
                          lineHeight: 1,
                        }}
                        title={`Drop database "${db}"`}
                      >
                        🗑
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Collection section */}
        {selectedDb && (
          <div
            style={{
              padding: "12px 16px",
              borderTop: "1px solid #243044",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "8px",
              }}
            >
              <span style={sectionLabelStyle}>COLLECTIONS</span>
              {canWrite && (
                <button
                  onClick={() => setNewColOpen(true)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#60a5fa",
                    fontSize: "16px",
                    lineHeight: 1,
                    padding: "0 2px",
                  }}
                  title="Create collection"
                >
                  ＋
                </button>
              )}
            </div>
            <input
              value={colSearch}
              onChange={(e) => setColSearch(e.target.value)}
              placeholder="Search collections…"
              style={sidebarSearchStyle}
            />
            {filteredCollections.length === 0 ? (
              <p
                style={{
                  color: "#64748b",
                  fontSize: "12px",
                  fontStyle: "italic",
                  padding: "8px 0",
                  margin: 0,
                  fontFamily: FONT,
                }}
              >
                No collections.{canWrite ? " Click ＋ to create one." : ""}
              </p>
            ) : (
              <div>
                {filteredCollections.map((col) => {
                  const isSelected = col === selectedCol;
                  const isHovered = hoveredCol === col;
                  return (
                    <div
                      key={col}
                      onClick={() => {
                        setSelectedCol(col);
                        setPage(1);
                      }}
                      onMouseEnter={() => setHoveredCol(col)}
                      onMouseLeave={() => setHoveredCol(null)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "7px 8px",
                        borderRadius: "6px",
                        cursor: "pointer",
                        background: isSelected
                          ? "#2563eb"
                          : isHovered
                          ? "#1e2d47"
                          : "transparent",
                        marginBottom: "2px",
                      }}
                    >
                      <span
                        style={{
                          flex: 1,
                          fontSize: "13px",
                          color: isSelected ? "#ffffff" : "#cbd5e1",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontFamily: FONT,
                        }}
                      >
                        {col}
                      </span>
                      {canWrite && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDropCollection(col);
                          }}
                          style={{
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            color: "#f87171",
                            fontSize: "12px",
                            padding: "0 2px",
                            lineHeight: 1,
                          }}
                          title={`Drop collection "${col}"`}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </aside>

      {/* ── Main area ── */}
      <main
        style={{
          flex: 1,
          background: "#f8fafc",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {!selectedCol ? (
          /* Empty state */
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "40px",
            }}
          >
            <div style={{ fontSize: "48px", marginBottom: "16px" }}>🗄</div>
            <h2
              style={{
                fontSize: "18px",
                color: "#374151",
                fontWeight: 600,
                margin: "0 0 8px 0",
                fontFamily: FONT,
              }}
            >
              Select a database and collection
            </h2>
            <p
              style={{
                fontSize: "14px",
                color: "#94a3b8",
                margin: 0,
                fontFamily: FONT,
              }}
            >
              {selectedDb
                ? "Choose a collection from the sidebar to browse documents."
                : "Choose a database from the sidebar to get started."}
            </p>
            {selectedDb &&
              collections.length === 0 &&
              ["admin", "config", "local"].includes(selectedDb) && (
                <p
                  style={{
                    marginTop: "16px",
                    fontSize: "13px",
                    color: "#94a3b8",
                    maxWidth: "400px",
                    textAlign: "center",
                    fontFamily: FONT,
                  }}
                >
                  <strong>{selectedDb}</strong> is a MongoDB system database.
                  Consider creating your own database instead.
                </p>
              )}
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div
              style={{
                position: "sticky",
                top: 0,
                background: "#ffffff",
                borderBottom: "1px solid #e2e8f0",
                padding: "12px 20px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                zIndex: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "14px",
                  fontFamily: FONT,
                }}
              >
                <span style={{ color: "#64748b" }}>{selectedDb}</span>
                <span style={{ color: "#94a3b8" }}>›</span>
                <span style={{ color: "#0f172a", fontWeight: 700 }}>
                  {selectedCol}
                </span>
              </div>
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  padding: "3px 10px",
                  borderRadius: "999px",
                  fontFamily: FONT,
                  background: canWrite ? "#dcfce7" : "#f1f5f9",
                  color: canWrite ? "#166534" : "#64748b",
                }}
              >
                {canWrite ? "● Admin" : "● Viewer"}
              </span>
            </div>

            {/* Tab bar */}
            <div
              style={{
                background: "#ffffff",
                borderBottom: "1px solid #e2e8f0",
                padding: "0 20px",
                display: "flex",
                flexDirection: "row",
              }}
            >
              {(["documents", "aggregate", "schema", "indexes"] as View[]).map((tab) => {
                const isActive = view === tab;
                const label =
                  tab.charAt(0).toUpperCase() + tab.slice(1);
                return (
                  <button
                    key={tab}
                    onClick={() => setView(tab)}
                    style={{
                      padding: "10px 16px",
                      fontSize: "13px",
                      borderTop: "none",
                      borderLeft: "none",
                      borderRight: "none",
                      borderBottom: isActive
                        ? "2px solid #2563eb"
                        : "2px solid transparent",
                      color: isActive ? "#2563eb" : "#64748b",
                      cursor: "pointer",
                      background: "transparent",
                      fontFamily: FONT,
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    {label}
                    {tab === "documents" && isActive && (
                      <span
                        style={{
                          background: "#f1f5f9",
                          color: "#64748b",
                          fontSize: "11px",
                          padding: "1px 6px",
                          borderRadius: "999px",
                          fontWeight: 600,
                        }}
                      >
                        {total}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* ── Documents tab ── */}
            {view === "documents" && (
              <>
                {/* Query bar */}
                {(() => {
                  const filterValid = !filterText.trim() || (() => { try { JSON.parse(filterText); return true; } catch { return false; } })();
                  const sortValid   = !sortText.trim()   || (() => { try { JSON.parse(sortText);   return true; } catch { return false; } })();
                  const hasFilter   = !!filterText.trim();
                  const hasSort     = !!sortText.trim();
                  return (
                    <div style={{ padding: "10px 20px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                      {/* Row 1: filter + sort inputs */}
                      <div style={{ display: "flex", gap: "8px", alignItems: "flex-end", marginBottom: "8px" }}>
                        {/* Filter */}
                        <div style={{ flex: 2 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                            <span style={{ fontSize: "11px", fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", fontFamily: FONT }}>Filter</span>
                            {hasFilter && filterValid && (
                              <span style={{ fontSize: "10px", background: "#dbeafe", color: "#1d4ed8", borderRadius: "999px", padding: "1px 7px", fontWeight: 600 }}>active</span>
                            )}
                            {hasFilter && !filterValid && (
                              <span style={{ fontSize: "10px", background: "#fee2e2", color: "#dc2626", borderRadius: "999px", padding: "1px 7px", fontWeight: 600 }}>invalid JSON</span>
                            )}
                          </div>
                          <input
                            style={{
                              width: "100%", boxSizing: "border-box",
                              padding: "8px 12px", borderRadius: "6px", fontSize: "13px",
                              fontFamily: "monospace", outline: "none", background: "#ffffff", color: "#1e293b",
                              border: hasFilter && !filterValid ? "1px solid #fca5a5" : hasFilter ? "1px solid #93c5fd" : "1px solid #e2e8f0",
                            }}
                            placeholder='e.g. {"status":"active"}  or  {"price":{"$gt":20}}'
                            value={filterText}
                            onChange={(e) => { setFilterText(e.target.value); setPage(1); }}
                            onKeyDown={(e) => e.key === "Enter" && filterValid && sortValid && loadDocuments()}
                          />
                        </div>

                        {/* Sort */}
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                            <span style={{ fontSize: "11px", fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", fontFamily: FONT }}>Sort</span>
                            {hasSort && !sortValid && (
                              <span style={{ fontSize: "10px", background: "#fee2e2", color: "#dc2626", borderRadius: "999px", padding: "1px 7px", fontWeight: 600 }}>invalid JSON</span>
                            )}
                          </div>
                          <input
                            style={{
                              width: "100%", boxSizing: "border-box",
                              padding: "8px 12px", borderRadius: "6px", fontSize: "13px",
                              fontFamily: "monospace", outline: "none", background: "#ffffff", color: "#1e293b",
                              border: hasSort && !sortValid ? "1px solid #fca5a5" : hasSort ? "1px solid #93c5fd" : "1px solid #e2e8f0",
                            }}
                            placeholder='e.g. {"price":-1}'
                            value={sortText}
                            onChange={(e) => { setSortText(e.target.value); setPage(1); }}
                            onKeyDown={(e) => e.key === "Enter" && filterValid && sortValid && loadDocuments()}
                          />
                        </div>

                        {/* Limit */}
                        <div style={{ flexShrink: 0 }}>
                          <div style={{ fontSize: "11px", fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", fontFamily: FONT, marginBottom: "4px" }}>Limit</div>
                          <select
                            value={limitVal}
                            onChange={(e) => { setLimitVal(Number(e.target.value)); setPage(1); }}
                            style={{ padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: "6px", fontSize: "13px", fontFamily: FONT, background: "#fff", color: "#374151" }}
                          >
                            {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                          </select>
                        </div>
                      </div>

                      {/* Row 2: action buttons */}
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <button
                          onClick={loadDocuments}
                          disabled={!filterValid || !sortValid}
                          style={{ background: filterValid && sortValid ? "#2563eb" : "#94a3b8", color: "#fff", padding: "6px 14px", borderRadius: "6px", fontSize: "13px", border: "none", cursor: filterValid && sortValid ? "pointer" : "default", fontFamily: FONT, fontWeight: 600 }}
                        >
                          Apply
                        </button>
                        {(hasFilter || hasSort) && (
                          <button
                            onClick={() => { setFilterText(""); setSortText(""); setPage(1); }}
                            style={{ background: "#fff", color: "#64748b", padding: "6px 12px", borderRadius: "6px", fontSize: "13px", border: "1px solid #e2e8f0", cursor: "pointer", fontFamily: FONT }}
                          >
                            Clear
                          </button>
                        )}
                        <div style={{ flex: 1 }} />
                        <button
                          onClick={() => exportCollection(selectedDb, selectedCol).catch((e: unknown) => alert("Export failed: " + (e as Error).message))}
                          style={{ background: "transparent", color: "#374151", padding: "6px 14px", borderRadius: "6px", fontSize: "13px", border: "1px solid #e2e8f0", cursor: "pointer", fontFamily: FONT }}
                        >
                          Export
                        </button>
                        {canWrite && (
                          <>
                            <label style={{ background: "transparent", color: "#374151", padding: "6px 14px", borderRadius: "6px", fontSize: "13px", border: "1px solid #e2e8f0", cursor: "pointer", fontFamily: FONT }}>
                              Import
                              <input type="file" accept=".json" style={{ display: "none" }} onChange={(e) => void handleImport(e)} />
                            </label>
                            <button onClick={openCreate} style={{ background: "#2563eb", color: "#fff", padding: "6px 14px", borderRadius: "6px", fontSize: "13px", border: "none", cursor: "pointer", fontFamily: FONT, fontWeight: 600 }}>
                              + New Document
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Document table */}
                <div style={{ padding: "0 20px 20px" }}>
                  {error && (
                    <p
                      style={{
                        color: "#dc2626",
                        fontSize: "13px",
                        margin: "12px 0",
                        fontFamily: FONT,
                      }}
                    >
                      {error}
                    </p>
                  )}
                  {loading ? (
                    <p
                      style={{
                        color: "#64748b",
                        fontSize: "13px",
                        padding: "20px 0",
                        fontFamily: FONT,
                      }}
                    >
                      Loading…
                    </p>
                  ) : (
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: "13px",
                        fontFamily: FONT,
                      }}
                    >
                      <thead>
                        <tr
                          style={{
                            background: "#f8fafc",
                            borderBottom: "2px solid #e2e8f0",
                          }}
                        >
                          <th
                            style={{
                              width: "180px",
                              padding: "10px 12px",
                              textAlign: "left",
                              color: "#64748b",
                              fontWeight: 600,
                              textTransform: "uppercase",
                              letterSpacing: "0.05em",
                              fontSize: "11px",
                            }}
                          >
                            _id
                          </th>
                          <th
                            style={{
                              padding: "10px 12px",
                              textAlign: "left",
                              color: "#64748b",
                              fontWeight: 600,
                              textTransform: "uppercase",
                              letterSpacing: "0.05em",
                              fontSize: "11px",
                            }}
                          >
                            Preview
                          </th>
                          <th
                            style={{
                              width: "100px",
                              padding: "10px 12px",
                              textAlign: "right",
                              color: "#64748b",
                              fontWeight: 600,
                              textTransform: "uppercase",
                              letterSpacing: "0.05em",
                              fontSize: "11px",
                            }}
                          >
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {documents.length === 0 ? (
                          <tr>
                            <td
                              colSpan={3}
                              style={{
                                textAlign: "center",
                                padding: "40px 20px",
                              }}
                            >
                              <div
                                style={{
                                  fontSize: "32px",
                                  marginBottom: "8px",
                                }}
                              >
                                📭
                              </div>
                              <p
                                style={{
                                  color: "#374151",
                                  margin: "0 0 4px 0",
                                  fontWeight: 500,
                                  fontFamily: FONT,
                                }}
                              >
                                No documents found
                              </p>
                              <p
                                style={{
                                  color: "#94a3b8",
                                  fontSize: "12px",
                                  margin: 0,
                                  fontFamily: FONT,
                                }}
                              >
                                {filterText
                                  ? "Try adjusting your filter."
                                  : "This collection is empty."}
                              </p>
                            </td>
                          </tr>
                        ) : (
                          documents.map((doc) => {
                            const id = getDocId(doc);
                            return (
                              <tr
                                key={id}
                                style={{ borderBottom: "1px solid #f1f5f9" }}
                                onMouseEnter={(e) =>
                                  (e.currentTarget.style.background = "#f8fafc")
                                }
                                onMouseLeave={(e) =>
                                  (e.currentTarget.style.background = "")
                                }
                              >
                                <td
                                  style={{
                                    padding: "10px 12px",
                                    fontFamily: "monospace",
                                    fontSize: "12px",
                                    color: "#6366f1",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    maxWidth: "180px",
                                  }}
                                >
                                  {id}
                                </td>
                                <td
                                  style={{
                                    padding: "10px 12px",
                                    color: "#374151",
                                    maxWidth: "0",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {previewDoc(doc)}
                                </td>
                                <td
                                  style={{
                                    padding: "10px 12px",
                                    textAlign: "right",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  <button
                                    onClick={() => openEdit(doc)}
                                    style={{
                                      background: "transparent",
                                      color: "#374151",
                                      border: "1px solid #e2e8f0",
                                      padding: "4px 10px",
                                      borderRadius: "4px",
                                      fontSize: "12px",
                                      cursor: "pointer",
                                      marginRight: "6px",
                                      fontFamily: FONT,
                                    }}
                                  >
                                    Edit
                                  </button>
                                  {canWrite && (
                                    <button
                                      onClick={() => void handleDelete(id)}
                                      style={{
                                        background: "#fee2e2",
                                        color: "#dc2626",
                                        border: "none",
                                        padding: "4px 10px",
                                        borderRadius: "4px",
                                        fontSize: "12px",
                                        cursor: "pointer",
                                        fontFamily: FONT,
                                      }}
                                    >
                                      Delete
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Pagination bar */}
                {!loading && (
                  <div
                    style={{
                      padding: "12px 20px",
                      background: "#ffffff",
                      borderTop: "1px solid #e2e8f0",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginTop: "auto",
                    }}
                  >
                    <span
                      style={{
                        color: "#64748b",
                        fontSize: "13px",
                        fontFamily: FONT,
                      }}
                    >
                      Showing {startDoc}–{endDoc} of {total} documents
                    </span>
                    <div
                      style={{
                        display: "flex",
                        gap: "8px",
                        alignItems: "center",
                      }}
                    >
                      <button
                        onClick={() => setPage((p) => p - 1)}
                        disabled={page === 1}
                        style={{
                          background: "transparent",
                          color: page === 1 ? "#cbd5e1" : "#374151",
                          border: "1px solid #e2e8f0",
                          padding: "6px 12px",
                          borderRadius: "6px",
                          fontSize: "13px",
                          cursor: page === 1 ? "not-allowed" : "pointer",
                          fontFamily: FONT,
                        }}
                      >
                        ← Prev
                      </button>
                      <span
                        style={{
                          fontSize: "13px",
                          color: "#64748b",
                          fontFamily: FONT,
                        }}
                      >
                        Page {page}
                      </span>
                      <button
                        onClick={() => setPage((p) => p + 1)}
                        disabled={documents.length < limit}
                        style={{
                          background: "transparent",
                          color:
                            documents.length < limit ? "#cbd5e1" : "#374151",
                          border: "1px solid #e2e8f0",
                          padding: "6px 12px",
                          borderRadius: "6px",
                          fontSize: "13px",
                          cursor:
                            documents.length < limit
                              ? "not-allowed"
                              : "pointer",
                          fontFamily: FONT,
                        }}
                      >
                        Next →
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── Aggregate tab ── */}
            {view === "aggregate" && (
              <div style={{ padding: "20px", fontFamily: FONT }}>
                <p
                  style={{
                    fontSize: "13px",
                    color: "#64748b",
                    margin: "0 0 12px 0",
                  }}
                >
                  Enter an aggregation pipeline (JSON array):
                </p>
                <div
                  style={{
                    height: "220px",
                    border: "1px solid #e2e8f0",
                    borderRadius: "6px",
                    overflow: "hidden",
                  }}
                >
                  <Editor
                    height="220px"
                    defaultLanguage="json"
                    value={pipeline}
                    onChange={(v) => setPipeline(v ?? "[]")}
                  />
                </div>
                <button
                  onClick={() => void runAggregate()}
                  style={{
                    marginTop: "12px",
                    background: "#2563eb",
                    color: "#ffffff",
                    padding: "8px 16px",
                    borderRadius: "6px",
                    fontSize: "13px",
                    border: "none",
                    cursor: "pointer",
                    fontFamily: FONT,
                    fontWeight: 500,
                  }}
                >
                  Run Pipeline
                </button>
                {aggResults.length > 0 && (
                  <pre
                    style={{
                      marginTop: "16px",
                      background: "#1e2638",
                      color: "#e2e8f0",
                      borderRadius: "8px",
                      padding: "16px",
                      fontSize: "12px",
                      overflow: "auto",
                      maxHeight: "400px",
                      fontFamily: "monospace",
                    }}
                  >
                    {JSON.stringify(aggResults, null, 2)}
                  </pre>
                )}
              </div>
            )}

            {/* ── Schema tab ── */}
            {view === "schema" && (
              <div style={{ padding: "20px", fontFamily: FONT }}>
                {schemaLoading ? (
                  <p style={{ color: "#64748b", fontSize: "13px" }}>
                    Inferring schema…
                  </p>
                ) : schema ? (
                  <SchemaViewer
                    fields={schema.fields}
                    sampledDocs={schema.sampled_documents}
                  />
                ) : (
                  <p style={{ color: "#94a3b8", fontSize: "13px" }}>
                    No schema data available.
                  </p>
                )}
              </div>
            )}

            {/* ── Indexes tab ── */}
            {view === "indexes" && (
              <div style={{ padding: "20px", fontFamily: FONT }}>
                {/* Toolbar */}
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
                  <span style={{ fontSize: "13px", color: "#64748b", flex: 1 }}>
                    {indexesLoading ? "Loading…" : `${indexes.length} index${indexes.length !== 1 ? "es" : ""}`}
                  </span>
                  <button
                    onClick={() => { setIndexName(""); setIndexKeys([{ field: "", direction: 1 }]); setIndexUnique(false); setIndexSparse(false); setIndexBackground(true); setIndexTtl(""); setNewIndexOpen(true); }}
                    style={{ padding: "6px 14px", background: "#2563eb", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}
                  >
                    + New Index
                  </button>
                </div>

                {/* Index table */}
                {indexes.length === 0 && !indexesLoading ? (
                  <p style={{ color: "#94a3b8", fontSize: "13px" }}>No indexes found.</p>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                      <thead>
                        <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
                          {["Name", "Keys", "Unique", "Sparse", "TTL (s)", ""].map((h) => (
                            <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#475569", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {indexes.map((idx) => (
                          <tr key={idx.name} style={{ borderBottom: "1px solid #e2e8f0" }}>
                            <td style={{ padding: "8px 12px", color: "#1e293b", fontWeight: 500 }}>{idx.name}</td>
                            <td style={{ padding: "8px 12px" }}>
                              <code style={{ background: "#f1f5f9", padding: "2px 6px", borderRadius: "4px", fontSize: "12px", color: "#334155" }}>
                                {Object.entries(idx.keys).map(([f, d]) => `${f}: ${d}`).join(", ")}
                              </code>
                            </td>
                            <td style={{ padding: "8px 12px", color: idx.unique ? "#16a34a" : "#94a3b8" }}>
                              {idx.unique ? "✓" : "—"}
                            </td>
                            <td style={{ padding: "8px 12px", color: idx.sparse ? "#16a34a" : "#94a3b8" }}>
                              {idx.sparse ? "✓" : "—"}
                            </td>
                            <td style={{ padding: "8px 12px", color: "#64748b" }}>
                              {idx.ttl !== undefined ? idx.ttl : "—"}
                            </td>
                            <td style={{ padding: "8px 12px" }}>
                              {idx.name !== "_id_" && (
                                <button
                                  onClick={() => {
                                    if (!confirm(`Drop index "${idx.name}"?`)) return;
                                    dropIndex(selectedDb, selectedCol, idx.name)
                                      .then(loadIndexes)
                                      .catch((e: unknown) => alert("Error: " + (e as Error).message));
                                  }}
                                  style={{ padding: "3px 10px", background: "#fff", border: "1px solid #fca5a5", color: "#dc2626", borderRadius: "5px", cursor: "pointer", fontSize: "12px", fontWeight: 500 }}
                                >
                                  Drop
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* ── Editor modal ── */}
      {editorOpen && (
        <div style={overlayStyle}>
          <div style={{ ...modalBaseStyle, width: "680px" }}>
            <h3 style={modalTitleStyle}>
              {editingId ? "Edit Document" : "New Document"}
            </h3>
            <p style={modalSubtitleStyle}>
              {editingId
                ? "Edit the JSON document below."
                : "Enter a JSON document to insert."}
            </p>
            <Editor
              height="400px"
              defaultLanguage="json"
              value={editorValue}
              onChange={(v) => setEditorValue(v ?? "{}")}
            />
            <div style={modalFooterStyle}>
              <button
                onClick={() => setEditorOpen(false)}
                style={cancelBtnStyle}
              >
                Cancel
              </button>
              <button onClick={() => void handleSave()} style={primaryBtnStyle}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create Database modal ── */}
      {newDbOpen && (
        <div style={overlayStyle}>
          <div style={modalBaseStyle}>
            <h3 style={modalTitleStyle}>Create Database</h3>
            <p style={modalSubtitleStyle}>
              MongoDB creates a database when its first collection is created.
            </p>
            <label style={modalLabelStyle}>Database name</label>
            <input
              style={modalInputStyle}
              placeholder="e.g. myapp"
              value={newDbName}
              onChange={(e) => setNewDbName(e.target.value)}
            />
            <label style={modalLabelStyle}>Initial collection name</label>
            <input
              style={modalInputStyle}
              placeholder="e.g. users"
              value={newDbCollection}
              onChange={(e) => setNewDbCollection(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleCreateDb()}
            />
            <div style={modalFooterStyle}>
              <button
                onClick={() => setNewDbOpen(false)}
                style={cancelBtnStyle}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleCreateDb()}
                style={primaryBtnStyle}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create Collection modal ── */}
      {newColOpen && (
        <div style={overlayStyle}>
          <div style={modalBaseStyle}>
            <h3 style={modalTitleStyle}>Create Collection</h3>
            <p style={modalSubtitleStyle}>
              Add a new collection to <strong>{selectedDb}</strong>.
            </p>
            <label style={modalLabelStyle}>Collection name</label>
            <input
              style={modalInputStyle}
              placeholder="e.g. products"
              value={newColName}
              onChange={(e) => setNewColName(e.target.value)}
              autoFocus
              onKeyDown={(e) =>
                e.key === "Enter" && void handleCreateCollection()
              }
            />
            <div style={modalFooterStyle}>
              <button
                onClick={() => setNewColOpen(false)}
                style={cancelBtnStyle}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleCreateCollection()}
                style={primaryBtnStyle}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Create Index modal ── */}
      {newIndexOpen && (
        <div style={overlayStyle}>
          <div style={{ ...modalBaseStyle, width: "560px" }}>
            <h3 style={modalTitleStyle}>Create Index</h3>
            <p style={modalSubtitleStyle}>
              Define the fields and options for the new index.
            </p>

            {/* Key builder */}
            <label style={modalLabelStyle}>Index Keys</label>
            {indexKeys.map((k, i) => (
              <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "8px", alignItems: "center" }}>
                <input
                  style={{ ...modalInputStyle, flex: 2, marginBottom: 0 }}
                  placeholder="field name"
                  value={k.field}
                  onChange={(e) => {
                    const updated = [...indexKeys];
                    updated[i] = { ...updated[i], field: e.target.value };
                    setIndexKeys(updated);
                  }}
                />
                <select
                  value={k.direction}
                  onChange={(e) => {
                    const updated = [...indexKeys];
                    updated[i] = { ...updated[i], direction: Number(e.target.value) as 1 | -1 };
                    setIndexKeys(updated);
                  }}
                  style={{ padding: "9px 8px", border: "1px solid #e2e8f0", borderRadius: "8px", fontSize: "13px", fontFamily: FONT, background: "#fff", color: "#374151" }}
                >
                  <option value={1}>1 (asc)</option>
                  <option value={-1}>-1 (desc)</option>
                </select>
                {indexKeys.length > 1 && (
                  <button
                    onClick={() => setIndexKeys(indexKeys.filter((_, j) => j !== i))}
                    style={{ padding: "6px 10px", background: "#fff", border: "1px solid #fca5a5", color: "#dc2626", borderRadius: "6px", cursor: "pointer", fontSize: "13px" }}
                  >✕</button>
                )}
              </div>
            ))}
            <button
              onClick={() => setIndexKeys([...indexKeys, { field: "", direction: 1 }])}
              style={{ fontSize: "12px", color: "#2563eb", background: "none", border: "none", cursor: "pointer", marginBottom: "16px", padding: 0 }}
            >
              + Add field
            </button>

            {/* Options */}
            <label style={modalLabelStyle}>Index Name <span style={{ fontWeight: 400, color: "#94a3b8" }}>(optional)</span></label>
            <input
              style={modalInputStyle}
              placeholder="auto-generated if empty"
              value={indexName}
              onChange={(e) => setIndexName(e.target.value)}
            />

            <div style={{ display: "flex", gap: "24px", marginBottom: "16px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#374151", cursor: "pointer" }}>
                <input type="checkbox" checked={indexUnique} onChange={(e) => setIndexUnique(e.target.checked)} />
                Unique
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#374151", cursor: "pointer" }}>
                <input type="checkbox" checked={indexSparse} onChange={(e) => setIndexSparse(e.target.checked)} />
                Sparse
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#374151", cursor: "pointer" }}>
                <input type="checkbox" checked={indexBackground} onChange={(e) => setIndexBackground(e.target.checked)} />
                <span>
                  Background
                  <span style={{ fontSize: "11px", color: "#94a3b8", marginLeft: "4px" }}>(non-blocking)</span>
                </span>
              </label>
            </div>

            <label style={modalLabelStyle}>TTL <span style={{ fontWeight: 400, color: "#94a3b8" }}>(seconds, optional)</span></label>
            <input
              style={modalInputStyle}
              placeholder="e.g. 3600"
              type="number"
              value={indexTtl}
              onChange={(e) => setIndexTtl(e.target.value)}
            />

            <div style={modalFooterStyle}>
              <button onClick={() => setNewIndexOpen(false)} style={cancelBtnStyle}>Cancel</button>
              <button
                onClick={() => {
                  const keys = Object.fromEntries(
                    indexKeys.filter((k) => k.field.trim()).map((k) => [k.field.trim(), k.direction])
                  ) as Record<string, 1 | -1>;
                  if (Object.keys(keys).length === 0) { alert("At least one field is required."); return; }
                  createIndex(selectedDb, selectedCol, keys, {
                    name: indexName.trim() || undefined,
                    unique: indexUnique || undefined,
                    sparse: indexSparse || undefined,
                    background: indexBackground,
                    ttl: indexTtl ? Number(indexTtl) : undefined,
                  })
                    .then(() => { setNewIndexOpen(false); loadIndexes(); })
                    .catch((e: unknown) => alert("Error: " + (e as Error).message));
                }}
                style={primaryBtnStyle}
              >
                Create Index
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
