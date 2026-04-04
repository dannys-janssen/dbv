import { useState, useEffect, useCallback, useRef } from "react";
import {
  getDocuments,
  deleteDocument,
  bulkDeleteDocuments,
  exportCollection,
  importCollection,
  aggregate,
  createDocument,
  updateDocument,
  getSchema,
  listIndexes,
  createIndex,
  dropIndex,
  getCollectionStats,
  type CollectionSchema,
  type IndexInfo,
  type IndexKey,
} from "../api/mongo";
import { useAuth } from "../context/AuthContext";
import Editor, { loader } from "@monaco-editor/react";
import SchemaViewer from "../components/SchemaViewer";
import DocTreeView from "../components/DocTreeView";
import CommandsView from "../components/CommandsView";
import {
  buildDocumentSchema,
  buildFilterSchema,
  buildSortSchema,
  PIPELINE_SCHEMA,
} from "../utils/mongoSchema";
import { formatBsonValue } from "../utils/bsonFormat";

type View = "documents" | "aggregate" | "schema" | "indexes" | "stats" | "commands";

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function numVal(v: unknown): number {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "$numberInt" in v) return Number((v as Record<string, unknown>)["$numberInt"]);
  if (v && typeof v === "object" && "$numberLong" in v) return Number((v as Record<string, unknown>)["$numberLong"]);
  if (v && typeof v === "object" && "$numberDouble" in v) return Number((v as Record<string, unknown>)["$numberDouble"]);
  return 0;
}

function previewDoc(doc: Record<string, unknown>): string {
  const entries = Object.entries(doc)
    .filter(([k]) => k !== "_id")
    .map(([k, v]) => {
      const val = typeof v === "object" && v !== null
        ? formatBsonValue(v)
        : String(v);
      return `${k}: ${val}`;
    });
  const preview = entries.join("  ·  ");
  return preview.length > 120 ? preview.slice(0, 120) + "…" : preview;
}

function getDocId(doc: Record<string, unknown>): string {
  const id = doc["_id"] as Record<string, unknown> | string | undefined;
  if (typeof id === "object" && id !== null)
    return (id as Record<string, unknown>)["$oid"] as string;
  return String(id ?? "");
}

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

interface CollectionViewProps {
  db: string;
  col: string;
  visible: boolean;
}

export default function CollectionView({ db, col, visible }: CollectionViewProps) {
  const { canWrite } = useAuth();

  const [view, setView] = useState<View>("documents");
  const [documents, setDocuments] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filterText, setFilterText] = useState("");
  const [sortText, setSortText] = useState("");
  const [limitVal, setLimitVal] = useState(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [docLayout, setDocLayout] = useState<"table" | "tree">("table");
  const loadDocumentsRef = useRef<() => void>(() => {});

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorValue, setEditorValue] = useState("{}");
  const [editingId, setEditingId] = useState<string | null>(null);

  const [pipeline, setPipeline] = useState("[]");
  const [aggResults, setAggResults] = useState<Record<string, unknown>[]>([]);

  const [schema, setSchema] = useState<CollectionSchema | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);

  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [indexesLoading, setIndexesLoading] = useState(false);
  const [newIndexOpen, setNewIndexOpen] = useState(false);
  const [indexKeys, setIndexKeys] = useState<IndexKey[]>([{ field: "", direction: 1 }]);
  const [indexName, setIndexName] = useState("");
  const [indexUnique, setIndexUnique] = useState(false);
  const [indexSparse, setIndexSparse] = useState(false);
  const [indexBackground, setIndexBackground] = useState(true);
  const [indexTtl, setIndexTtl] = useState("");

  const [colStats, setColStats] = useState<Record<string, unknown> | null>(null);
  const [colStatsLoading, setColStatsLoading] = useState(false);

  const loadSchema = useCallback(() => {
    if (!db || !col) return;
    setSchemaLoading(true);
    getSchema(db, col)
      .then(setSchema)
      .catch(() => setSchema(null))
      .finally(() => setSchemaLoading(false));
  }, [db, col]);

  useEffect(() => {
    if (view === "schema") loadSchema();
  }, [view, loadSchema]);

  useEffect(() => {
    void loader.init().then((monaco) => {
      const docSchema  = schema ? buildDocumentSchema(schema) : { type: "object" };
      const filtSchema = schema ? buildFilterSchema(schema)   : { type: "object" };
      const sortSchema = schema ? buildSortSchema(schema)     : { type: "object" };
      monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
        validate: true,
        schemas: [
          { uri: "http://dbv/document-schema.json", fileMatch: ["dbv://document"], schema: docSchema },
          { uri: "http://dbv/filter-schema.json",   fileMatch: ["dbv://filter"],   schema: filtSchema },
          { uri: "http://dbv/sort-schema.json",     fileMatch: ["dbv://sort"],     schema: sortSchema },
          { uri: "http://dbv/pipeline-schema.json", fileMatch: ["dbv://pipeline"], schema: PIPELINE_SCHEMA },
        ],
      });
    });
  }, [schema]);

  const loadIndexes = useCallback(() => {
    if (!db || !col) return;
    setIndexesLoading(true);
    listIndexes(db, col)
      .then((r) => setIndexes(r.indexes))
      .catch(() => setIndexes([]))
      .finally(() => setIndexesLoading(false));
  }, [db, col]);

  useEffect(() => {
    if (view === "indexes") loadIndexes();
  }, [view, loadIndexes]);

  const loadColStats = useCallback(() => {
    if (!db || !col) return;
    setColStatsLoading(true);
    getCollectionStats(db, col)
      .then(setColStats)
      .catch(() => setColStats(null))
      .finally(() => setColStatsLoading(false));
  }, [db, col]);

  useEffect(() => {
    if (view === "stats") loadColStats();
  }, [view, loadColStats]);

  const loadDocuments = useCallback(() => {
    if (!db || !col) return;
    setLoading(true);
    setError("");
    setSelectedIds(new Set());
    getDocuments(db, col, page, limitVal, filterText || undefined, sortText || undefined)
      .then((r) => {
        setDocuments(r.documents);
        setTotal(r.total);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [db, col, page, limitVal, filterText, sortText]);

  useEffect(() => { loadDocumentsRef.current = loadDocuments; }, [loadDocuments]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this document?")) return;
    await deleteDocument(db, col, id);
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
        await updateDocument(db, col, editingId, parsed);
      } else {
        await createDocument(db, col, parsed);
      }
      setEditorOpen(false);
      loadDocuments();
    } catch (e: unknown) {
      alert("Invalid JSON or save failed: " + (e as Error).message);
    }
  }, [editorValue, editingId, db, col, loadDocuments]);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const docs = JSON.parse(text) as unknown[];
    if (!confirm(`Import ${docs.length} documents? (replace existing?)`)) return;
    await importCollection(db, col, docs, true);
    loadDocuments();
  };

  const runAggregate = useCallback(async () => {
    try {
      const p = JSON.parse(pipeline) as unknown[];
      const r = await aggregate(db, col, p);
      setAggResults(r.results);
    } catch (e: unknown) {
      alert("Error: " + (e as Error).message);
    }
  }, [pipeline, db, col]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editorOpen)   { setEditorOpen(false);   return; }
        if (newIndexOpen) { setNewIndexOpen(false);  return; }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "s" && editorOpen) {
        e.preventDefault();
        void handleSave();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && view === "aggregate") {
        e.preventDefault();
        void runAggregate();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editorOpen, newIndexOpen, view, handleSave, runAggregate]);

  const startDoc = total > 0 ? (page - 1) * limitVal + 1 : 0;
  const endDoc = Math.min(page * limitVal, total);

  return (
    <div style={{ display: visible ? "flex" : "none", flex: 1, flexDirection: "column", overflow: "hidden" }}>
      {!col ? (
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
            {db
              ? "Choose a collection from the sidebar to browse documents."
              : "Choose a database from the sidebar to get started."}
          </p>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
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
              <span style={{ color: "#64748b" }}>{db}</span>
              <span style={{ color: "#94a3b8" }}>›</span>
              <span style={{ color: "#0f172a", fontWeight: 700 }}>
                {col}
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

          {/* View tab bar */}
          <div
            style={{
              background: "#ffffff",
              borderBottom: "1px solid #e2e8f0",
              padding: "0 20px",
              display: "flex",
              flexDirection: "row",
            }}
          >
            {(["documents", "aggregate", "schema", "indexes", "stats", "commands"] as View[]).map((tab) => {
              const isActive = view === tab;
              const label = tab.charAt(0).toUpperCase() + tab.slice(1);
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
                const monoOpts = {
                  minimap: { enabled: false },
                  lineNumbers: "off" as const,
                  folding: false,
                  renderLineHighlight: "none" as const,
                  scrollBeyondLastLine: false,
                  overviewRulerLanes: 0,
                  hideCursorInOverviewRuler: true,
                  wordWrap: "on" as const,
                  padding: { top: 6, bottom: 6 },
                  fontSize: 13,
                  contextmenu: false,
                  suggest: { showSnippets: true, showWords: false },
                  quickSuggestions: { other: true, comments: false, strings: true },
                };
                return (
                  <div style={{ padding: "10px 20px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                    {/* Row 1: filter + sort inputs */}
                    <div style={{ display: "flex", gap: "8px", alignItems: "flex-end", marginBottom: "8px" }}>
                      {/* Filter */}
                      <div style={{ flex: 2 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                          <span style={{ fontSize: "11px", fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", fontFamily: FONT }}>Filter</span>
                          <span style={{ fontSize: "10px", color: "#94a3b8", fontFamily: FONT }}>Ctrl+Enter to apply</span>
                          {hasFilter && filterValid && (
                            <span style={{ fontSize: "10px", background: "#dbeafe", color: "#1d4ed8", borderRadius: "999px", padding: "1px 7px", fontWeight: 600 }}>active</span>
                          )}
                          {hasFilter && !filterValid && (
                            <span style={{ fontSize: "10px", background: "#fee2e2", color: "#dc2626", borderRadius: "999px", padding: "1px 7px", fontWeight: 600 }}>invalid JSON</span>
                          )}
                        </div>
                        <div style={{
                          border: hasFilter && !filterValid ? "1px solid #fca5a5" : hasFilter ? "1px solid #93c5fd" : "1px solid #e2e8f0",
                          borderRadius: "6px", overflow: "hidden", background: "#ffffff",
                        }}>
                          <Editor
                            height="68px"
                            language="json"
                            path="dbv://filter"
                            value={filterText}
                            onChange={(v) => { setFilterText(v ?? ""); setPage(1); }}
                            options={monoOpts}
                            onMount={(editor, monaco) => {
                              editor.addCommand(
                                monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
                                () => loadDocumentsRef.current()
                              );
                            }}
                          />
                        </div>
                      </div>

                      {/* Sort */}
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                          <span style={{ fontSize: "11px", fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", fontFamily: FONT }}>Sort</span>
                          {hasSort && !sortValid && (
                            <span style={{ fontSize: "10px", background: "#fee2e2", color: "#dc2626", borderRadius: "999px", padding: "1px 7px", fontWeight: 600 }}>invalid JSON</span>
                          )}
                        </div>
                        <div style={{
                          border: hasSort && !sortValid ? "1px solid #fca5a5" : hasSort ? "1px solid #93c5fd" : "1px solid #e2e8f0",
                          borderRadius: "6px", overflow: "hidden", background: "#ffffff",
                        }}>
                          <Editor
                            height="68px"
                            language="json"
                            path="dbv://sort"
                            value={sortText}
                            onChange={(v) => { setSortText(v ?? ""); setPage(1); }}
                            options={monoOpts}
                            onMount={(editor, monaco) => {
                              editor.addCommand(
                                monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
                                () => loadDocumentsRef.current()
                              );
                            }}
                          />
                        </div>
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
                      {/* Layout toggle */}
                      <div style={{ display: "flex", border: "1px solid #e2e8f0", borderRadius: "6px", overflow: "hidden" }}>
                        <button
                          title="Table view"
                          onClick={() => setDocLayout("table")}
                          style={{ background: docLayout === "table" ? "#2563eb" : "transparent", color: docLayout === "table" ? "#fff" : "#64748b", border: "none", padding: "5px 10px", cursor: "pointer", fontSize: "14px", lineHeight: "1" }}
                        >
                          ☰
                        </button>
                        <button
                          title="Tree view"
                          onClick={() => setDocLayout("tree")}
                          style={{ background: docLayout === "tree" ? "#2563eb" : "transparent", color: docLayout === "tree" ? "#fff" : "#64748b", border: "none", borderLeft: "1px solid #e2e8f0", padding: "5px 10px", cursor: "pointer", fontSize: "14px", lineHeight: "1" }}
                        >
                          🌲
                        </button>
                      </div>
                      <button
                        onClick={() => exportCollection(db, col).catch((e: unknown) => alert("Export failed: " + (e as Error).message))}
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

              {/* Bulk action bar */}
              {selectedIds.size > 0 && (
                <div style={{
                  padding: "8px 20px",
                  background: "#eff6ff",
                  borderBottom: "1px solid #bfdbfe",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                }}>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "#1d4ed8", flex: 1 }}>
                    {selectedIds.size} document{selectedIds.size !== 1 ? "s" : ""} selected
                  </span>
                  <button
                    onClick={() => {
                      const selected = documents.filter((d) => selectedIds.has(getDocId(d)));
                      const blob = new Blob([JSON.stringify(selected, null, 2)], { type: "application/json" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `${col}_selection.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    style={{ padding: "5px 14px", background: "#fff", border: "1px solid #bfdbfe", color: "#1d4ed8", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontFamily: FONT, fontWeight: 500 }}
                  >
                    Export Selected
                  </button>
                  {canWrite && (
                    <button
                      onClick={async () => {
                        if (!confirm(`Delete ${selectedIds.size} selected document${selectedIds.size !== 1 ? "s" : ""}? This cannot be undone.`)) return;
                        try {
                          await bulkDeleteDocuments(db, col, [...selectedIds]);
                          loadDocuments();
                        } catch (e: unknown) {
                          alert("Delete failed: " + (e as Error).message);
                        }
                      }}
                      style={{ padding: "5px 14px", background: "#fee2e2", border: "none", color: "#dc2626", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontFamily: FONT, fontWeight: 500 }}
                    >
                      Delete Selected
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    style={{ padding: "5px 10px", background: "transparent", border: "none", color: "#64748b", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontFamily: FONT }}
                  >
                    ✕ Clear
                  </button>
                </div>
              )}

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
                ) : docLayout === "tree" ? (
                  <DocTreeView
                    documents={documents}
                    selectedIds={selectedIds}
                    onSelectOne={(id, checked) =>
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (checked) next.add(id);
                        else next.delete(id);
                        return next;
                      })
                    }
                    onSelectAll={(checked) => {
                      if (checked) setSelectedIds(new Set(documents.map((d) => getDocId(d))));
                      else setSelectedIds(new Set());
                    }}
                    canWrite={canWrite}
                    onEdit={openEdit}
                    onDelete={(id) => void handleDelete(id)}
                    getDocId={getDocId}
                    loading={false}
                    filterText={filterText}
                  />
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
                        <th style={{ width: "40px", padding: "10px 12px", textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={documents.length > 0 && documents.every((d) => selectedIds.has(getDocId(d)))}
                            ref={(el) => {
                              if (el) el.indeterminate = selectedIds.size > 0 && !documents.every((d) => selectedIds.has(getDocId(d)));
                            }}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedIds(new Set(documents.map((d) => getDocId(d))));
                              } else {
                                setSelectedIds(new Set());
                              }
                            }}
                          />
                        </th>
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
                            colSpan={4}
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
                          const isSelected = selectedIds.has(id);
                          return (
                            <tr
                              key={id}
                              style={{ borderBottom: "1px solid #f1f5f9", background: isSelected ? "#eff6ff" : undefined }}
                              onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "#f8fafc"; }}
                              onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ""; }}
                            >
                              <td style={{ padding: "10px 12px", textAlign: "center" }}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(e) => {
                                    setSelectedIds((prev) => {
                                      const next = new Set(prev);
                                      if (e.target.checked) next.add(id);
                                      else next.delete(id);
                                      return next;
                                    });
                                  }}
                                />
                              </td>
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
                      disabled={documents.length < limitVal}
                      style={{
                        background: "transparent",
                        color: documents.length < limitVal ? "#cbd5e1" : "#374151",
                        border: "1px solid #e2e8f0",
                        padding: "6px 12px",
                        borderRadius: "6px",
                        fontSize: "13px",
                        cursor: documents.length < limitVal ? "not-allowed" : "pointer",
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
                  path="dbv://pipeline"
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
                                  dropIndex(db, col, idx.name)
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

          {/* ── Stats tab ── */}
          {view === "stats" && (
            <div style={{ padding: "20px", fontFamily: FONT }}>
              {colStatsLoading ? (
                <p style={{ color: "#64748b", fontSize: "13px" }}>Loading stats…</p>
              ) : !colStats ? (
                <p style={{ color: "#94a3b8", fontSize: "13px" }}>No stats available.</p>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
                    <span style={{ fontSize: "13px", color: "#64748b", flex: 1 }}>Collection statistics</span>
                    <button onClick={loadColStats} style={{ padding: "5px 12px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: "6px", cursor: "pointer", fontSize: "12px", color: "#374151", fontFamily: FONT }}>↻ Refresh</button>
                  </div>
                  {(() => {
                    const s = colStats;
                    const cards: { label: string; value: string; sub?: string }[] = [
                      { label: "Documents",        value: numVal(s["count"]).toLocaleString() },
                      { label: "Avg document size", value: formatBytes(numVal(s["avgObjSize"])) },
                      { label: "Data size",         value: formatBytes(numVal(s["size"])) },
                      { label: "Storage size",      value: formatBytes(numVal(s["storageSize"])) },
                      { label: "Indexes",           value: numVal(s["nindexes"]).toLocaleString() },
                      { label: "Index size",        value: formatBytes(numVal(s["totalIndexSize"])) },
                    ];
                    return (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "12px", marginBottom: "24px" }}>
                        {cards.map((c) => (
                          <div key={c.label} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "14px 16px" }}>
                            <div style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>{c.label}</div>
                            <div style={{ fontSize: "22px", fontWeight: 700, color: "#1e293b" }}>{c.value}</div>
                            {c.sub && <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "2px" }}>{c.sub}</div>}
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  {colStats["indexSizes"] && typeof colStats["indexSizes"] === "object" && (
                    <>
                      <h4 style={{ fontSize: "13px", fontWeight: 600, color: "#374151", margin: "0 0 10px 0" }}>Index sizes</h4>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                        <thead>
                          <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
                            <th style={{ padding: "6px 12px", textAlign: "left", color: "#475569", fontWeight: 600 }}>Index</th>
                            <th style={{ padding: "6px 12px", textAlign: "right", color: "#475569", fontWeight: 600 }}>Size</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(colStats["indexSizes"] as Record<string, unknown>).map(([name, size]) => (
                            <tr key={name} style={{ borderBottom: "1px solid #e2e8f0" }}>
                              <td style={{ padding: "6px 12px", color: "#1e293b" }}>
                                <code style={{ background: "#f1f5f9", color: "#334155", padding: "1px 5px", borderRadius: "3px", fontSize: "12px" }}>{name}</code>
                              </td>
                              <td style={{ padding: "6px 12px", textAlign: "right", color: "#64748b" }}>{formatBytes(numVal(size))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Commands tab ── */}
          {view === "commands" && (
            <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <CommandsView db={db} collection={col} />
            </div>
          )}
        </div>
      )}

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
              path="dbv://document"
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

      {/* ── Create Index modal ── */}
      {newIndexOpen && (
        <div style={overlayStyle}>
          <div style={{ ...modalBaseStyle, width: "560px" }}>
            <h3 style={modalTitleStyle}>Create Index</h3>
            <p style={modalSubtitleStyle}>
              Define the fields and options for the new index.
            </p>

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
                  createIndex(db, col, keys, {
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
