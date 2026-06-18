import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  getDocuments,
  deleteDocument,
  bulkDeleteDocuments,
  deleteManyDocuments,
  exportCollection,
  exportCollectionBson,
  importCollection,
  importCollectionBson,
  aggregate,
  createDocument,
  updateDocument,
  getSchema,
  listIndexes,
  createIndex,
  dropIndex,
  getCollectionStats,
  runDbCommand,
  type CollectionSchema,
  type IndexInfo,
  type IndexKey,
} from "../api/mongo";
import { useAuth } from "../context/useAuth";
import Editor, { loader } from "@monaco-editor/react";
import { useTheme } from "@mui/material/styles";
import SchemaViewer from "../components/SchemaViewer";
import DocTreeView from "../components/DocTreeView";
import CommandsView from "../components/CommandsView";
import DocFormEditor from "../components/DocFormEditor";
import {
  buildDocumentSchema,
  buildFilterSchema,
  buildSortSchema,
  buildProjectionSchema,
  PIPELINE_SCHEMA,
} from "../utils/mongoSchema";
import { formatBsonValue, normalizeBsonForReadonlyJson } from "../utils/bsonFormat";
import { parseSqlToMql } from "../utils/sqlToMql";
import { buildUpdateManyCommand, parseUpdateManyInput } from "../utils/updateMany";
import { buildDeleteManyRequest, parseDeleteManyInput } from "../utils/deleteMany";
import { registerDbvMonacoThemes, type MonacoWithDefineTheme } from "../utils/monacoTheme";

type View = "documents" | "aggregate" | "update" | "delete" | "schema" | "indexes" | "stats" | "commands";

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
interface MonacoJsonSchemaInstance extends MonacoWithDefineTheme {
  languages?: {
    json?: {
      jsonDefaults?: {
        setDiagnosticsOptions: (options: unknown) => void;
      };
    };
  };
}

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

/** Build a MongoDB filter string that matches a set of document IDs. */
function buildSelectionFilter(ids: Set<string>): string {
  const filterIds = [...ids].map((id) =>
    /^[0-9a-fA-F]{24}$/.test(id) ? { $oid: id } : id
  );
  return JSON.stringify({ _id: { $in: filterIds } });
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
  tabId: string;
}

export default function CollectionView({ db, col, visible, tabId }: CollectionViewProps) {
  const { canWrite } = useAuth();
  const { t } = useTranslation();
  const muiTheme = useTheme();
  const isDark = muiTheme.palette.mode === "dark";
  const [monacoReady, setMonacoReady] = useState(false);
  const editorTheme = monacoReady ? (isDark ? "dbv-dark" : "dbv-light") : (isDark ? "vs-dark" : "vs");
  const monacoRef = useRef<MonacoJsonSchemaInstance | null>(null);

  const [view, setView] = useState<View>("documents");
  const [documents, setDocuments] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filterText, setFilterText] = useState("");
  const [sortText, setSortText] = useState("");
  const [projectionText, setProjectionText] = useState("");
  const [limitVal, setLimitVal] = useState(20);
  const [queryMode, setQueryMode] = useState<"mql" | "sql">("mql");
  const [sqlText, setSqlText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [docLayout, setDocLayout] = useState<"table" | "tree" | "json">("table");
  const loadDocumentsRef = useRef<() => void>(() => {});

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorValue, setEditorValue] = useState("{}");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<"form" | "json">("form");

  const [pipeline, setPipeline] = useState("[]");
  const [aggResults, setAggResults] = useState<Record<string, unknown>[]>([]);
  const [aggError, setAggError] = useState("");
  const [aggLoading, setAggLoading] = useState(false);
  const [queryDuration, setQueryDuration] = useState<number | null>(null);
  const [aggDuration, setAggDuration] = useState<number | null>(null);
  const [updateManyText, setUpdateManyText] = useState('(\n  { "status": "inactive" },\n  { "$set": { "archived": true } }\n)');
  const [updateManyResult, setUpdateManyResult] = useState<Record<string, unknown> | null>(null);
  const [updateManyError, setUpdateManyError] = useState("");
  const [updateManyLoading, setUpdateManyLoading] = useState(false);
  const [updateManyDuration, setUpdateManyDuration] = useState<number | null>(null);
  const [deleteManyText, setDeleteManyText] = useState('(\n  { "status": "inactive" },\n  {\n    "writeConcern": {},\n    "collation": {},\n    "hint": "",\n    "maxTimeMS": 30000,\n    "let": {}\n  }\n)');
  const [deleteManyResult, setDeleteManyResult] = useState<Record<string, unknown> | null>(null);
  const [deleteManyError, setDeleteManyError] = useState("");
  const [deleteManyLoading, setDeleteManyLoading] = useState(false);
  const [deleteManyDuration, setDeleteManyDuration] = useState<number | null>(null);

  // Editor heights for resizable panels
  const [filterHeight, setFilterHeight] = useState(68);
  const [aggHeight, setAggHeight] = useState(180);
  const [sqlHeight, setSqlHeight] = useState(68);
  const filterResizing = useRef(false);
  const aggResizing = useRef(false);
  const sqlResizing = useRef(false);

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
  const [indexPartialFilter, setIndexPartialFilter] = useState("");

  const [colStats, setColStats] = useState<Record<string, unknown> | null>(null);
  const [colStatsLoading, setColStatsLoading] = useState(false);

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importReplace, setImportReplace] = useState(false);
  const [importPending, setImportPending] = useState<
    | { kind: "bson"; buffer: ArrayBuffer; filename: string }
    | { kind: "json"; docs: unknown[]; filename: string }
    | null
  >(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const loadSchema = useCallback(() => {
    if (!db || !col) return;
    setSchemaLoading(true);
    getSchema(db, col)
      .then(setSchema)
      .catch(() => setSchema(null))
      .finally(() => setSchemaLoading(false));
  }, [db, col]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: sets loading before async fetch
    if (view === "schema") loadSchema();
  }, [view, loadSchema]);

  useEffect(() => {
    void loader.init().then((monaco) => {
      monacoRef.current = monaco as MonacoJsonSchemaInstance;
      registerDbvMonacoThemes(monaco);
      setMonacoReady(true);
    }).catch(() => setMonacoReady(false));
  }, []);

  useEffect(() => {
    if (!monacoReady || !monacoRef.current) return;
    const jsonDefaults = monacoRef.current.languages?.json?.jsonDefaults;
    if (!jsonDefaults || typeof jsonDefaults.setDiagnosticsOptions !== "function") return;
    const docSchema  = schema ? buildDocumentSchema(schema)  : { type: "object" };
    const filtSchema = schema ? buildFilterSchema(schema)    : { type: "object" };
    const sortSchema = schema ? buildSortSchema(schema)      : { type: "object" };
    const projSchema = schema ? buildProjectionSchema(schema): { type: "object" };
    try {
      jsonDefaults.setDiagnosticsOptions({
        validate: true,
        schemas: [
          { uri: `http://dbv/document-schema-${tabId}.json`,   fileMatch: [`dbv://document/${tabId}`],   schema: docSchema },
          { uri: `http://dbv/filter-schema-${tabId}.json`,     fileMatch: [`dbv://filter/${tabId}`],     schema: filtSchema },
          { uri: `http://dbv/sort-schema-${tabId}.json`,       fileMatch: [`dbv://sort/${tabId}`],       schema: sortSchema },
          { uri: `http://dbv/projection-schema-${tabId}.json`, fileMatch: [`dbv://projection/${tabId}`], schema: projSchema },
          { uri: `http://dbv/pipeline-schema-${tabId}.json`,   fileMatch: [`dbv://pipeline/${tabId}`],   schema: PIPELINE_SCHEMA },
        ],
      });
    } catch {
      setMonacoReady(false);
    }
  }, [monacoReady, schema, tabId, visible]);

  const loadIndexes = useCallback(() => {
    if (!db || !col) return;
    setIndexesLoading(true);
    listIndexes(db, col)
      .then((r) => setIndexes(r.indexes))
      .catch(() => setIndexes([]))
      .finally(() => setIndexesLoading(false));
  }, [db, col]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: sets loading before async fetch
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: sets loading before async fetch
    if (view === "stats") loadColStats();
  }, [view, loadColStats]);

  const loadDocuments = useCallback(() => {
    if (!db || !col) return;
    setLoading(true);
    setError("");
    setSelectedIds(new Set());
    const t0 = Date.now();
    getDocuments(db, col, page, limitVal, filterText || undefined, sortText || undefined, projectionText || undefined)
      .then((r) => {
        setDocuments(r.documents);
        setTotal(r.total);
        setQueryDuration(Date.now() - t0);
      })
      .catch((e) => { setError((e as Error).message); setQueryDuration(null); })
      .finally(() => setLoading(false));
  }, [db, col, page, limitVal, filterText, sortText, projectionText]);

  useEffect(() => { loadDocumentsRef.current = loadDocuments; }, [loadDocuments]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: sets loading before async fetch
    loadDocuments();
  }, [loadDocuments]);

  const handleDelete = async (id: string) => {
    if (!confirm(t("modals.confirmDelete.document"))) return;
    await deleteDocument(db, col, id);
    loadDocuments();
  };

  const openCreate = () => {
    setEditingId(null);
    setEditorValue("{}");
    setEditorMode("form");
    if (!schema) loadSchema();
    setEditorOpen(true);
  };

  const openEdit = (doc: Record<string, unknown>) => {
    const id = getDocId(doc);
    setEditingId(id);
    setEditorValue(JSON.stringify(doc, null, 2));
    setEditorMode("form");
    if (!schema) loadSchema();
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
      alert(t("editor.error.saveFailure") + " " + (e as Error).message);
    }
  }, [editorValue, editingId, db, col, loadDocuments]);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset the input so the same file can be re-selected after cancel
    if (importInputRef.current) importInputRef.current.value = "";
    const isBson = file.name.endsWith(".bson");
    if (isBson) {
      const buffer = await file.arrayBuffer();
      setImportPending({ kind: "bson", buffer, filename: file.name });
    } else {
      const text = await file.text();
      const docs = JSON.parse(text) as unknown[];
      setImportPending({ kind: "json", docs, filename: file.name });
    }
    setImportReplace(false);
    setImportModalOpen(true);
  };

  const handleImportConfirm = async () => {
    if (!importPending) return;
    try {
      if (importPending.kind === "bson") {
        await importCollectionBson(db, col, importPending.buffer, importReplace);
      } else {
        await importCollection(db, col, importPending.docs, importReplace);
      }
      setImportModalOpen(false);
      setImportPending(null);
      loadDocuments();
    } catch (e: unknown) {
      const axiosBody = (e as { response?: { data?: { error?: string } } }).response?.data?.error;
      setError(t("modals.import.error") + " " + (axiosBody ?? (e as Error).message ?? "Unknown error"));
      setImportModalOpen(false);
      setImportPending(null);
    }
  };

  const runAggregate = useCallback(async () => {
    try {
      const p = JSON.parse(pipeline) as unknown[];
      setAggLoading(true);
      setAggError("");
      setAggResults([]);
      const t0 = Date.now();
      const r = await aggregate(db, col, p);
      setAggResults(r.results);
      setAggError("");
      setAggDuration(Date.now() - t0);
    } catch (e: unknown) {
      setAggResults([]);
      setAggDuration(null);
      // Prefer the descriptive message from the backend response body over
      // the generic axios "Request failed with status code 5xx" message.
      const axiosBody = (e as { response?: { data?: { error?: string } } }).response?.data?.error;
      setAggError(axiosBody ?? (e as Error).message ?? "Unknown error");
    } finally {
      setAggLoading(false);
    }
  }, [pipeline, db, col]);

  const runUpdateMany = useCallback(async () => {
    let parsed;
    try {
      parsed = parseUpdateManyInput(updateManyText);
    } catch {
      setUpdateManyError(t("update.error.invalidFormat"));
      setUpdateManyDuration(null);
      return;
    }

    setUpdateManyLoading(true);
    setUpdateManyError("");
    setUpdateManyResult(null);
    setUpdateManyDuration(null);
    const t0 = Date.now();

    try {
      const result = await runDbCommand(db, buildUpdateManyCommand(col, parsed), false);
      setUpdateManyResult(result);
      setUpdateManyDuration(Date.now() - t0);
    } catch (e: unknown) {
      const axiosBody = (e as { response?: { data?: { error?: string } } }).response?.data?.error;
      setUpdateManyError(axiosBody ?? (e as Error).message ?? "Unknown error");
      setUpdateManyDuration(null);
    } finally {
      setUpdateManyLoading(false);
    }
  }, [updateManyText, db, col, t]);

  const runDeleteMany = useCallback(async () => {
    let parsed;
    try {
      parsed = parseDeleteManyInput(deleteManyText);
    } catch {
      setDeleteManyError(t("delete.error.invalidFormat"));
      setDeleteManyDuration(null);
      return;
    }

    setDeleteManyLoading(true);
    setDeleteManyError("");
    setDeleteManyResult(null);
    setDeleteManyDuration(null);
    const t0 = Date.now();

    try {
      const request = buildDeleteManyRequest(parsed);
      const result = await deleteManyDocuments(db, col, request.filter, request.options);
      setDeleteManyResult(result);
      setDeleteManyDuration(Date.now() - t0);
    } catch (e: unknown) {
      const axiosBody = (e as { response?: { data?: { error?: string } } }).response?.data?.error;
      setDeleteManyError(axiosBody ?? (e as Error).message ?? "Unknown error");
      setDeleteManyDuration(null);
    } finally {
      setDeleteManyLoading(false);
    }
  }, [deleteManyText, db, col, t]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (importModalOpen) { setImportModalOpen(false); setImportPending(null); return; }
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
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canWrite && view === "update") {
        e.preventDefault();
        void runUpdateMany();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canWrite && view === "delete") {
        e.preventDefault();
        void runDeleteMany();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [importModalOpen, editorOpen, newIndexOpen, view, handleSave, runAggregate, runUpdateMany, runDeleteMany, canWrite]);

  const startDoc = total > 0 ? (page - 1) * limitVal + 1 : 0;
  const endDoc = Math.min(page * limitVal, total);
  const startFilterResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    filterResizing.current = true;
    const startY = e.clientY;
    const startH = filterHeight;
    const onMouseMove = (ev: MouseEvent) => {
      if (!filterResizing.current) return;
      setFilterHeight(Math.min(600, Math.max(48, startH + ev.clientY - startY)));
    };
    const onMouseUp = () => {
      filterResizing.current = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [filterHeight]);

  const startSqlResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    sqlResizing.current = true;
    const startY = e.clientY;
    const startH = sqlHeight;
    const onMouseMove = (ev: MouseEvent) => {
      if (!sqlResizing.current) return;
      setSqlHeight(Math.min(600, Math.max(48, startH + ev.clientY - startY)));
    };
    const onMouseUp = () => {
      sqlResizing.current = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [sqlHeight]);

  const startAggResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    aggResizing.current = true;
    const startY = e.clientY;
    const startH = aggHeight;
    const onMouseMove = (ev: MouseEvent) => {
      if (!aggResizing.current) return;
      setAggHeight(Math.min(600, Math.max(48, startH + ev.clientY - startY)));
    };
    const onMouseUp = () => {
      aggResizing.current = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [aggHeight]);

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
  };

  const resizeHandleStyle: React.CSSProperties = {
    height: "6px",
    cursor: "row-resize",
    background: "linear-gradient(to bottom, #e2e8f0, #f1f5f9)",
    borderTop: "1px solid #e2e8f0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    userSelect: "none",
    flexShrink: 0,
  };

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
            {t("empty.title")}
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
              ? t("empty.subtitle.collectionNeeded")
              : t("empty.subtitle.databaseNeeded")}
          </p>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          {/* Toolbar */}
          <div
            style={{
              position: "sticky",
              top: 0,
              background: muiTheme.palette.background.paper,
              borderBottom: `1px solid ${muiTheme.palette.divider}`,
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
              <span style={{ color: muiTheme.palette.text.secondary }}>{db}</span>
              <span style={{ color: muiTheme.palette.text.secondary }}>›</span>
              <span style={{ color: muiTheme.palette.text.primary, fontWeight: 700 }}>
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
              {canWrite ? t("badge.admin") : t("badge.viewer")}
            </span>
          </div>

          {/* View tab bar */}
          <div
            style={{
              background: muiTheme.palette.background.paper,
              borderBottom: `1px solid ${muiTheme.palette.divider}`,
              padding: "0 20px",
              display: "flex",
              flexDirection: "row",
            }}
          >
            {((canWrite
              ? ["documents", "aggregate", "update", "delete", "schema", "indexes", "stats", "commands"]
              : ["documents", "aggregate", "schema", "indexes", "stats", "commands"]) as View[]).map((tab) => {
              const isActive = view === tab;
              const label = t(`tabs.${tab}`);
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
                      ? `2px solid ${muiTheme.palette.primary.main}`
                      : "2px solid transparent",
                    color: isActive ? muiTheme.palette.primary.main : muiTheme.palette.text.secondary,
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
                        background: muiTheme.palette.action.selected,
                        color: muiTheme.palette.text.secondary,
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
                const projValid   = !projectionText.trim() || (() => { try { JSON.parse(projectionText); return true; } catch { return false; } })();
                const hasFilter   = !!filterText.trim();
                const hasSort     = !!sortText.trim();
                const hasProj     = !!projectionText.trim();

                // SQL mode parse
                const sqlResult = queryMode === "sql" ? parseSqlToMql(sqlText) : null;
                const sqlError = sqlResult && sqlResult.error ? sqlResult.error : null;
                const sqlValid = queryMode === "sql" ? (!sqlText.trim() || (!sqlError && sqlResult?.mql !== null)) : true;

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

                const applySql = () => {
                  if (!sqlResult || sqlResult.error !== null || !sqlResult.mql) return;
                  const { filter, sort, projection, limit } = sqlResult.mql;
                  setFilterText(Object.keys(filter).length ? JSON.stringify(filter) : "");
                  setSortText(Object.keys(sort).length ? JSON.stringify(sort) : "");
                  setProjectionText(Object.keys(projection).length ? JSON.stringify(projection) : "");
                  if (limit !== null) setLimitVal(Math.min(100, Math.max(1, limit)));
                  setPage(1);
                  loadDocumentsRef.current();
                };

                return (
                  <div style={{ padding: "10px 20px", background: muiTheme.palette.background.paper, borderBottom: `1px solid ${muiTheme.palette.divider}` }}>
                    {/* Mode toggle row */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                      <div
                        role="group"
                        aria-label={t("query.mode.label")}
                        style={{ display: "flex", border: `1px solid ${muiTheme.palette.divider}`, borderRadius: "6px", overflow: "hidden" }}
                      >
                        <button
                          role="radio"
                          aria-checked={queryMode === "mql"}
                          onClick={() => setQueryMode("mql")}
                          style={{ padding: "4px 12px", fontSize: "12px", fontWeight: 600, fontFamily: FONT, border: "none", cursor: "pointer", background: queryMode === "mql" ? muiTheme.palette.primary.main : muiTheme.palette.background.paper, color: queryMode === "mql" ? muiTheme.palette.primary.contrastText : muiTheme.palette.text.secondary }}
                        >
                          MQL
                        </button>
                        <button
                          role="radio"
                          aria-checked={queryMode === "sql"}
                          onClick={() => setQueryMode("sql")}
                          style={{ padding: "4px 12px", fontSize: "12px", fontWeight: 600, fontFamily: FONT, border: "none", borderLeft: `1px solid ${muiTheme.palette.divider}`, cursor: "pointer", background: queryMode === "sql" ? muiTheme.palette.primary.main : muiTheme.palette.background.paper, color: queryMode === "sql" ? muiTheme.palette.primary.contrastText : muiTheme.palette.text.secondary }}
                        >
                          SQL
                        </button>
                      </div>
                      <span style={{ fontSize: "11px", color: muiTheme.palette.text.secondary, fontFamily: FONT }}>
                        {queryMode === "sql" ? t("query.mode.sqlHint") : t("query.hint.ctrlEnter")}
                      </span>
                    </div>

                    {queryMode === "mql" ? (
                      <>
                        {/* MQL Row 1: filter + sort + projection + limit
                            All three editors share filterHeight — dragging any handle resizes all three together */}
                        <div style={{ display: "flex", gap: "8px", alignItems: "flex-start", marginBottom: "8px" }}>
                          {/* Filter */}
                          <div style={{ flex: 2 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                              <span style={{ fontSize: "11px", fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", fontFamily: FONT }}>{t("query.label.filter")}</span>
                              {hasFilter && filterValid && (
                                <span style={{ fontSize: "10px", background: "#dbeafe", color: "#1d4ed8", borderRadius: "999px", padding: "1px 7px", fontWeight: 600 }}>{t("query.badge.active")}</span>
                              )}
                              {hasFilter && !filterValid && (
                                <span style={{ fontSize: "10px", background: "#fee2e2", color: "#dc2626", borderRadius: "999px", padding: "1px 7px", fontWeight: 600 }}>{t("query.badge.invalidJson")}</span>
                              )}
                            </div>
                            <div style={{ border: hasFilter && !filterValid ? `1px solid ${muiTheme.palette.error.light}` : hasFilter ? `1px solid ${muiTheme.palette.primary.light}` : `1px solid ${muiTheme.palette.divider}`, borderRadius: "6px", overflow: "hidden", background: muiTheme.palette.background.paper }}>
                              <Editor theme={editorTheme} height={`${filterHeight}px`} language="json" path={`dbv://filter/${tabId}`} value={filterText}
                                onChange={(v) => { setFilterText(v ?? ""); setPage(1); }} options={monoOpts}
                                onMount={(editor, monaco) => {
                                  const keyMod = monaco?.KeyMod?.CtrlCmd;
                                  const keyCode = monaco?.KeyCode?.Enter;
                                  if (typeof keyMod === "number" && typeof keyCode === "number") {
                                    editor.addCommand(keyMod | keyCode, () => loadDocumentsRef.current());
                                  }
                                }} />
                              <div title={t("query.resize.title")} style={resizeHandleStyle}
                                onMouseDown={startFilterResize} />
                            </div>
                          </div>

                          {/* Sort */}
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                              <span style={{ fontSize: "11px", fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", fontFamily: FONT }}>{t("query.label.sort")}</span>
                              {hasSort && !sortValid && (
                                <span style={{ fontSize: "10px", background: "#fee2e2", color: "#dc2626", borderRadius: "999px", padding: "1px 7px", fontWeight: 600 }}>{t("query.badge.invalidJson")}</span>
                              )}
                            </div>
                            <div style={{ border: hasSort && !sortValid ? `1px solid ${muiTheme.palette.error.light}` : hasSort ? `1px solid ${muiTheme.palette.primary.light}` : `1px solid ${muiTheme.palette.divider}`, borderRadius: "6px", overflow: "hidden", background: muiTheme.palette.background.paper }}>
                              <Editor theme={editorTheme} height={`${filterHeight}px`} language="json" path={`dbv://sort/${tabId}`} value={sortText}
                                onChange={(v) => { setSortText(v ?? ""); setPage(1); }} options={monoOpts}
                                onMount={(editor, monaco) => {
                                  const keyMod = monaco?.KeyMod?.CtrlCmd;
                                  const keyCode = monaco?.KeyCode?.Enter;
                                  if (typeof keyMod === "number" && typeof keyCode === "number") {
                                    editor.addCommand(keyMod | keyCode, () => loadDocumentsRef.current());
                                  }
                                }} />
                              <div title={t("query.resize.title")} style={resizeHandleStyle}
                                onMouseDown={startFilterResize} />
                            </div>
                          </div>

                          {/* Projection */}
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                              <span style={{ fontSize: "11px", fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", fontFamily: FONT }}>{t("query.label.projection")}</span>
                              {hasProj && projValid && (
                                <span style={{ fontSize: "10px", background: "#dbeafe", color: "#1d4ed8", borderRadius: "999px", padding: "1px 7px", fontWeight: 600 }}>{t("query.badge.active")}</span>
                              )}
                              {hasProj && !projValid && (
                                <span style={{ fontSize: "10px", background: "#fee2e2", color: "#dc2626", borderRadius: "999px", padding: "1px 7px", fontWeight: 600 }}>{t("query.badge.invalidJson")}</span>
                              )}
                            </div>
                            <div style={{ border: hasProj && !projValid ? `1px solid ${muiTheme.palette.error.light}` : hasProj ? `1px solid ${muiTheme.palette.primary.light}` : `1px solid ${muiTheme.palette.divider}`, borderRadius: "6px", overflow: "hidden", background: muiTheme.palette.background.paper }}>
                              <Editor theme={editorTheme} height={`${filterHeight}px`} language="json" path={`dbv://projection/${tabId}`} value={projectionText}
                                onChange={(v) => { setProjectionText(v ?? ""); setPage(1); }} options={monoOpts}
                                onMount={(editor, monaco) => {
                                  const keyMod = monaco?.KeyMod?.CtrlCmd;
                                  const keyCode = monaco?.KeyCode?.Enter;
                                  if (typeof keyMod === "number" && typeof keyCode === "number") {
                                    editor.addCommand(keyMod | keyCode, () => loadDocumentsRef.current());
                                  }
                                }} />
                              <div title={t("query.resize.title")} style={resizeHandleStyle}
                                onMouseDown={startFilterResize} />
                            </div>
                          </div>

                          {/* Limit */}
                          <div style={{ flexShrink: 0 }}>
                            <div style={{ fontSize: "11px", fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", fontFamily: FONT, marginBottom: "4px" }}>{t("query.label.limit")}</div>
                            <select value={limitVal} onChange={(e) => { setLimitVal(Number(e.target.value)); setPage(1); }}
                              style={{ padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: "6px", fontSize: "13px", fontFamily: FONT, background: "#fff", color: "#374151" }}>
                              {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                          </div>
                        </div>

                        {/* MQL Row 2: action buttons + status */}
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          <button onClick={loadDocuments} disabled={!filterValid || !sortValid || !projValid}
                            style={{ background: filterValid && sortValid && projValid ? "#2563eb" : "#94a3b8", color: "#fff", padding: "6px 14px", borderRadius: "6px", fontSize: "13px", border: "none", cursor: filterValid && sortValid && projValid ? "pointer" : "default", fontFamily: FONT, fontWeight: 600 }}>
                            {loading ? t("query.button.loading") : t("query.button.apply")}
                          </button>
                          {(hasFilter || hasSort || hasProj) && (
                            <button onClick={() => { setFilterText(""); setSortText(""); setProjectionText(""); setPage(1); }}
                              style={{ background: "#fff", color: "#64748b", padding: "6px 12px", borderRadius: "6px", fontSize: "13px", border: "1px solid #e2e8f0", cursor: "pointer", fontFamily: FONT }}>
                              {t("query.button.clear")}
                            </button>
                          )}
                          {loading && (
                            <span role="status" aria-live="polite" style={{ fontSize: "12px", color: "#2563eb", fontFamily: FONT }}>
                              ⏳ {t("ui.loading")}
                            </span>
                          )}
                          {!loading && queryDuration !== null && (
                            <span style={{ fontSize: "11px", color: "#64748b", fontFamily: FONT }}>
                              {t("query.duration", { duration: formatDuration(queryDuration) })}
                            </span>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        {/* SQL editor */}
                        <div style={{ marginBottom: "8px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                            <label htmlFor="sql-editor" style={{ fontSize: "11px", fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", fontFamily: FONT }}>
                              {t("query.sql.label")}
                            </label>
                            {sqlText.trim() && sqlValid && sqlResult?.mql && (
                              <span style={{ fontSize: "10px", background: "#dbeafe", color: "#1d4ed8", borderRadius: "999px", padding: "1px 7px", fontWeight: 600 }}>{t("query.badge.active")}</span>
                            )}
                            {sqlText.trim() && sqlError && (
                              <span style={{ fontSize: "10px", background: "#fee2e2", color: "#dc2626", borderRadius: "999px", padding: "1px 7px", fontWeight: 600 }}>{t("query.sql.parseError")}</span>
                            )}
                          </div>
                          <div style={{ border: sqlError && sqlText.trim() ? `1px solid ${muiTheme.palette.error.light}` : sqlText.trim() && sqlValid ? `1px solid ${muiTheme.palette.primary.light}` : `1px solid ${muiTheme.palette.divider}`, borderRadius: "6px", overflow: "hidden", background: muiTheme.palette.background.paper }}>
                            <Editor theme={editorTheme}
                              height={`${sqlHeight}px`}
                              language="sql"
                              path={`dbv://sql/${tabId}`}
                              value={sqlText}
                              onChange={(v) => { setSqlText(v ?? ""); setPage(1); }}
                              options={{ ...monoOpts, suggest: { showSnippets: true, showWords: true } }}
                              onMount={(editor, monaco) => {
                                const keyMod = monaco?.KeyMod?.CtrlCmd;
                                const keyCode = monaco?.KeyCode?.Enter;
                                if (typeof keyMod === "number" && typeof keyCode === "number") {
                                  editor.addCommand(keyMod | keyCode, applySql);
                                }
                              }}
                            />
                            <div title={t("query.resize.title")} style={resizeHandleStyle}
                              onMouseDown={startSqlResize} />
                          </div>
                          {sqlError && sqlText.trim() && (
                            <div style={{ marginTop: "4px", fontSize: "12px", color: "#dc2626", fontFamily: FONT }}>{sqlError}</div>
                          )}
                        </div>

                        {/* SQL → MQL preview */}
                        {sqlResult?.mql && sqlText.trim() && (
                          <div style={{ marginBottom: "8px", padding: "8px 12px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: "6px", fontSize: "12px", fontFamily: "monospace", color: "#0369a1" }}>
                            <div style={{ fontWeight: 600, marginBottom: "4px", fontFamily: FONT, color: "#0284c7", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.04em" }}>{t("query.sql.mqlPreview")}</div>
                            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                              {sqlResult.preview.filter && <span><strong>filter:</strong> {sqlResult.preview.filter}</span>}
                              {sqlResult.preview.sort && <span><strong>sort:</strong> {sqlResult.preview.sort}</span>}
                              {sqlResult.preview.projection && <span><strong>projection:</strong> {sqlResult.preview.projection}</span>}
                              {sqlResult.preview.limit && <span><strong>limit:</strong> {sqlResult.preview.limit}</span>}
                              {!sqlResult.preview.filter && !sqlResult.preview.sort && !sqlResult.preview.projection && !sqlResult.preview.limit && (
                                <span style={{ color: "#64748b" }}>{t("query.sql.noConstraints")}</span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* SQL action buttons */}
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          <button onClick={applySql} disabled={!sqlValid || !sqlText.trim() || !sqlResult?.mql}
                            style={{ background: sqlValid && sqlText.trim() && sqlResult?.mql ? "#2563eb" : "#94a3b8", color: "#fff", padding: "6px 14px", borderRadius: "6px", fontSize: "13px", border: "none", cursor: sqlValid && sqlText.trim() && sqlResult?.mql ? "pointer" : "default", fontFamily: FONT, fontWeight: 600 }}>
                            {loading ? t("query.button.loading") : t("query.button.apply")}
                          </button>
                          {sqlText.trim() && (
                            <button onClick={() => { setSqlText(""); setFilterText(""); setSortText(""); setProjectionText(""); setPage(1); }}
                              style={{ background: "#fff", color: "#64748b", padding: "6px 12px", borderRadius: "6px", fontSize: "13px", border: "1px solid #e2e8f0", cursor: "pointer", fontFamily: FONT }}>
                              {t("query.button.clear")}
                            </button>
                          )}
                          {loading && (
                            <span role="status" aria-live="polite" style={{ fontSize: "12px", color: "#2563eb", fontFamily: FONT }}>
                              ⏳ {t("ui.loading")}
                            </span>
                          )}
                          {!loading && queryDuration !== null && (
                            <span style={{ fontSize: "11px", color: "#64748b", fontFamily: FONT }}>
                              {t("query.duration", { duration: formatDuration(queryDuration) })}
                            </span>
                          )}
                          <span style={{ fontSize: "11px", color: "#94a3b8", fontFamily: FONT }}>{t("query.sql.example", { col })}</span>
                        </div>
                      </>
                    )}

                    {/* Row: layout toggle + export/import/create */}
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "8px" }}>
                      <div style={{ flex: 1 }} />
                      {/* Layout toggle */}
                      <div style={{ display: "flex", border: `1px solid ${muiTheme.palette.divider}`, borderRadius: "6px", overflow: "hidden", height: "36px" }}>
                        <button
                          title={t("views.table.title")}
                          onClick={() => setDocLayout("table")}
                          style={{ background: docLayout === "table" ? muiTheme.palette.primary.main : "transparent", color: docLayout === "table" ? muiTheme.palette.primary.contrastText : muiTheme.palette.text.secondary, border: "none", padding: "0 10px", height: "100%", display: "flex", alignItems: "center", cursor: "pointer", fontSize: "14px", lineHeight: "1" }}
                        >
                          ☰
                        </button>
                        <button
                          title={t("views.tree.title")}
                          onClick={() => setDocLayout("tree")}
                          style={{ background: docLayout === "tree" ? muiTheme.palette.primary.main : "transparent", color: docLayout === "tree" ? muiTheme.palette.primary.contrastText : muiTheme.palette.text.secondary, border: "none", borderLeft: `1px solid ${muiTheme.palette.divider}`, padding: "0 10px", height: "100%", display: "flex", alignItems: "center", cursor: "pointer", fontSize: "14px", lineHeight: "1" }}
                        >
                          ⊞
                        </button>
                        <button
                          title={t("views.json.title")}
                          aria-label={t("views.json.title")}
                          onClick={() => setDocLayout("json")}
                          style={{ background: docLayout === "json" ? muiTheme.palette.primary.main : "transparent", color: docLayout === "json" ? muiTheme.palette.primary.contrastText : muiTheme.palette.text.secondary, border: "none", borderLeft: `1px solid ${muiTheme.palette.divider}`, padding: "0 10px", height: "100%", display: "flex", alignItems: "center", cursor: "pointer", fontSize: "14px", lineHeight: "1", fontFamily: "monospace" }}
                        >
                          {"{}"}
                        </button>
                      </div>
                      <div style={{ display: "flex", border: `1px solid ${muiTheme.palette.divider}`, borderRadius: "6px", overflow: "hidden", height: "36px" }}>
                        <button
                          onClick={() => exportCollection(db, col, filterText || undefined).catch((e: unknown) => alert("Export failed: " + (e as Error).message))}
                          style={{ background: "transparent", color: muiTheme.palette.text.primary, padding: "0 12px", height: "100%", display: "flex", alignItems: "center", fontSize: "13px", border: "none", borderRight: `1px solid ${muiTheme.palette.divider}`, cursor: "pointer", fontFamily: FONT }}
                          title={t("buttons.exportJson")}
                        >
                          {t("buttons.export")} JSON
                        </button>
                        <button
                          onClick={() => exportCollectionBson(db, col, filterText || undefined).catch((e: unknown) => alert("Export failed: " + (e as Error).message))}
                          style={{ background: "transparent", color: muiTheme.palette.text.primary, padding: "0 12px", height: "100%", display: "flex", alignItems: "center", fontSize: "13px", border: "none", cursor: "pointer", fontFamily: FONT }}
                          title={t("buttons.exportBson")}
                        >
                          {t("buttons.export")} BSON
                        </button>
                      </div>
                      {canWrite && (
                        <>
                          <label style={{ background: "transparent", color: muiTheme.palette.text.primary, padding: "0 14px", height: "36px", display: "flex", alignItems: "center", borderRadius: "6px", fontSize: "13px", border: `1px solid ${muiTheme.palette.divider}`, cursor: "pointer", fontFamily: FONT }}>
                            {t("buttons.import")}
                            <input ref={importInputRef} type="file" accept=".json,.bson" style={{ display: "none" }} onChange={(e) => void handleImport(e)} />
                          </label>
                          <button onClick={openCreate} style={{ background: muiTheme.palette.primary.main, color: muiTheme.palette.primary.contrastText, padding: "0 14px", height: "36px", display: "flex", alignItems: "center", borderRadius: "6px", fontSize: "13px", border: "none", cursor: "pointer", fontFamily: FONT, fontWeight: 600 }}>
                            {t("documents.button.create")}
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
                    {t("selection.count", { count: selectedIds.size })}
                  </span>
                  <div style={{ display: "flex", border: "1px solid #bfdbfe", borderRadius: "6px", overflow: "hidden" }}>
                    <button
                      onClick={() => {
                        const filter = buildSelectionFilter(selectedIds);
                        exportCollection(db, col, filter).catch((e: unknown) => alert("Export failed: " + (e as Error).message));
                      }}
                      style={{ padding: "5px 12px", background: "#fff", border: "none", borderRight: "1px solid #bfdbfe", color: "#1d4ed8", cursor: "pointer", fontSize: "13px", fontFamily: FONT, fontWeight: 500 }}
                    >
                      {t("selection.button.exportJson")}
                    </button>
                    <button
                      onClick={() => {
                        const filter = buildSelectionFilter(selectedIds);
                        exportCollectionBson(db, col, filter).catch((e: unknown) => alert("Export failed: " + (e as Error).message));
                      }}
                      style={{ padding: "5px 12px", background: "#fff", border: "none", color: "#1d4ed8", cursor: "pointer", fontSize: "13px", fontFamily: FONT, fontWeight: 500 }}
                    >
                      {t("selection.button.exportBson")}
                    </button>
                  </div>
                  {canWrite && (
                    <button
                      onClick={async () => {
                        if (!confirm(t("selection.confirmDelete", { count: selectedIds.size }))) return;
                        try {
                          await bulkDeleteDocuments(db, col, [...selectedIds]);
                          loadDocuments();
                        } catch (e: unknown) {
                          alert("Delete failed: " + (e as Error).message);
                        }
                      }}
                      style={{ padding: "5px 14px", background: "#fee2e2", border: "none", color: "#dc2626", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontFamily: FONT, fontWeight: 500 }}
                    >
                      {t("selection.button.delete")}
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    style={{ padding: "5px 10px", background: "transparent", border: "none", color: "#64748b", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontFamily: FONT }}
                  >
                    {t("selection.button.clear")}
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
                    {t("ui.loading")}
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
                ) : docLayout === "json" ? (
                  documents.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "40px 20px" }}>
                      <div style={{ fontSize: "32px", marginBottom: "8px" }}>📭</div>
                      <p style={{ color: muiTheme.palette.text.primary, margin: "0 0 4px 0", fontWeight: 500, fontFamily: FONT }}>
                        {t("documents.list.empty")}
                      </p>
                      <p style={{ color: muiTheme.palette.text.secondary, fontSize: "12px", margin: 0, fontFamily: FONT }}>
                        {filterText || projectionText ? t("documents.list.emptyWithFilter") : t("documents.list.emptyNoFilter")}
                      </p>
                    </div>
                  ) : (
                    <div>
                      {(() => {
                        const allSelected = documents.length > 0 && documents.every((d) => selectedIds.has(getDocId(d)));
                        const someSelected = selectedIds.size > 0 && !allSelected;
                        return (
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 2px", marginBottom: "6px", borderBottom: `1px solid ${muiTheme.palette.divider}` }}>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = someSelected;
                          }}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedIds(new Set(documents.map((d) => getDocId(d))));
                            else setSelectedIds(new Set());
                          }}
                          style={{ cursor: "pointer" }}
                        />
                        <span style={{ fontSize: "12px", color: muiTheme.palette.text.secondary, fontFamily: FONT }}>
                          {t("tree.checkbox.selectAllLabel")}
                        </span>
                      </div>
                        );
                      })()}
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {documents.map((doc, index) => {
                          const id = getDocId(doc);
                          return (
                            <div key={id || `doc-${index}`} style={{ border: `1px solid ${selectedIds.has(id) ? muiTheme.palette.primary.light : muiTheme.palette.divider}`, borderRadius: "8px", overflow: "hidden", background: selectedIds.has(id) ? muiTheme.palette.action.selected : muiTheme.palette.background.paper }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", background: selectedIds.has(id) ? muiTheme.palette.action.selected : muiTheme.palette.action.hover, borderBottom: `1px solid ${muiTheme.palette.divider}` }}>
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(id)}
                                  aria-label={`Select document ${id}`}
                                  onChange={(e) =>
                                    setSelectedIds((prev) => {
                                      const next = new Set(prev);
                                      if (e.target.checked) next.add(id);
                                      else next.delete(id);
                                      return next;
                                    })
                                  }
                                  style={{ cursor: "pointer" }}
                                />
                                <span style={{ fontFamily: "monospace", fontSize: "12px", color: muiTheme.palette.secondary.main, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {formatBsonValue(doc["_id"])}
                                </span>
                                <button
                                  onClick={() => openEdit(doc)}
                                  style={{ background: "transparent", color: muiTheme.palette.text.primary, border: `1px solid ${muiTheme.palette.divider}`, padding: "3px 10px", borderRadius: "4px", fontSize: "12px", cursor: "pointer", fontFamily: FONT }}
                                >
                                  {t("buttons.edit")}
                                </button>
                                {canWrite && (
                                  <button
                                    onClick={() => void handleDelete(id)}
                                    style={{ background: muiTheme.palette.error.light, color: muiTheme.palette.error.dark, border: "none", padding: "3px 10px", borderRadius: "4px", fontSize: "12px", cursor: "pointer", fontFamily: FONT }}
                                  >
                                    {t("buttons.delete")}
                                  </button>
                                )}
                              </div>
                              <Editor theme={editorTheme}
                                height="250px"
                                defaultLanguage="json"
                                path={`dbv://documents-readonly/${tabId}/${index}`}
                                value={JSON.stringify(normalizeBsonForReadonlyJson(doc), null, 2)}
                                options={{
                                  readOnly: true,
                                  minimap: { enabled: false },
                                  scrollBeyondLastLine: false,
                                  lineNumbers: "on",
                                  wordWrap: "on",
                                  automaticLayout: true,
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )
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
                          background: muiTheme.palette.action.hover,
                          borderBottom: `2px solid ${muiTheme.palette.divider}`,
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
                            color: muiTheme.palette.text.secondary,
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            fontSize: "11px",
                          }}
                        >
                          {t("table.header.id")}
                        </th>
                        <th
                          style={{
                            padding: "10px 12px",
                            textAlign: "left",
                            color: muiTheme.palette.text.secondary,
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            fontSize: "11px",
                          }}
                        >
                          {t("table.header.preview")}
                        </th>
                        <th
                          style={{
                            width: "100px",
                            padding: "10px 12px",
                            textAlign: "right",
                            color: muiTheme.palette.text.secondary,
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            fontSize: "11px",
                          }}
                        >
                          {t("table.header.actions")}
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
                                color: muiTheme.palette.text.primary,
                                margin: "0 0 4px 0",
                                fontWeight: 500,
                                fontFamily: FONT,
                              }}
                            >
                              {t("documents.list.empty")}
                            </p>
                            <p
                              style={{
                                color: muiTheme.palette.text.secondary,
                                fontSize: "12px",
                                margin: 0,
                                fontFamily: FONT,
                              }}
                            >
                              {filterText || projectionText
                                ? t("documents.list.emptyWithFilter")
                                : t("documents.list.emptyNoFilter")}
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
                              style={{ borderBottom: `1px solid ${muiTheme.palette.divider}`, background: isSelected ? muiTheme.palette.action.selected : undefined }}
                              onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = muiTheme.palette.action.hover; }}
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
                                  textAlign: "left",
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
                                  textAlign: "left",
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
                                    color: muiTheme.palette.text.primary,
                                    border: `1px solid ${muiTheme.palette.divider}`,
                                    padding: "4px 10px",
                                    borderRadius: "4px",
                                    fontSize: "12px",
                                    cursor: "pointer",
                                    marginRight: "6px",
                                    fontFamily: FONT,
                                  }}
                                >
                                  {t("buttons.edit")}
                                </button>
                                {canWrite && (
                                  <button
                                    onClick={() => void handleDelete(id)}
                                    style={{
                                      background: muiTheme.palette.error.light,
                                      color: muiTheme.palette.error.contrastText,
                                      border: "none",
                                      padding: "4px 10px",
                                      borderRadius: "4px",
                                      fontSize: "12px",
                                      cursor: "pointer",
                                      fontFamily: FONT,
                                    }}
                                  >
                                    {t("buttons.delete")}
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
                    background: muiTheme.palette.background.paper,
                    borderTop: `1px solid ${muiTheme.palette.divider}`,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginTop: "auto",
                  }}
                >
                  <span
                    style={{
                      color: muiTheme.palette.text.secondary,
                      fontSize: "13px",
                      fontFamily: FONT,
                    }}
                  >
                    {t("pagination.label", { start: startDoc, end: endDoc, total })}
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
                        color: page === 1 ? muiTheme.palette.text.disabled : muiTheme.palette.text.primary,
                        border: `1px solid ${muiTheme.palette.divider}`,
                        padding: "6px 12px",
                        borderRadius: "6px",
                        fontSize: "13px",
                        cursor: page === 1 ? "not-allowed" : "pointer",
                        fontFamily: FONT,
                      }}
                    >
                      {t("pagination.button.prev")}
                    </button>
                    <span
                      style={{
                        fontSize: "13px",
                        color: muiTheme.palette.text.secondary,
                        fontFamily: FONT,
                      }}
                    >
                      {t("pagination.label_page", { page })}
                    </span>
                    <button
                      onClick={() => setPage((p) => p + 1)}
                      disabled={documents.length < limitVal}
                      style={{
                        background: "transparent",
                        color: documents.length < limitVal ? muiTheme.palette.text.disabled : muiTheme.palette.text.primary,
                        border: `1px solid ${muiTheme.palette.divider}`,
                        padding: "6px 12px",
                        borderRadius: "6px",
                        fontSize: "13px",
                        cursor: documents.length < limitVal ? "not-allowed" : "pointer",
                        fontFamily: FONT,
                      }}
                    >
                      {t("pagination.button.next")}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Aggregate tab ── */}
          {view === "aggregate" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: FONT }}>
              {/* Pipeline editor */}
              <div style={{ padding: "16px 20px 0", flexShrink: 0 }}>
                <p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 8px 0" }}>
                  {t("aggregate.prompt")}
                </p>
                <div style={{ border: "1px solid #e2e8f0", borderRadius: "6px", overflow: "hidden" }}>
                  <Editor theme={editorTheme}
                    height={`${aggHeight}px`}
                    defaultLanguage="json"
                    path={`dbv://pipeline/${tabId}`}
                    value={pipeline}
                    onChange={(v) => setPipeline(v ?? "[]")}
                    options={{
                      minimap: { enabled: false },
                      lineNumbers: "off" as const,
                      folding: false,
                      scrollBeyondLastLine: false,
                      fontSize: 13,
                      padding: { top: 6, bottom: 6 },
                      wordWrap: "on" as const,
                      suggest: { showSnippets: true, showWords: false },
                      quickSuggestions: { other: true, comments: false, strings: true },
                    }}
                    onMount={(editor, monaco) => {
                      const keyMod = monaco?.KeyMod?.CtrlCmd;
                      const keyCode = monaco?.KeyCode?.Enter;
                      if (typeof keyMod === "number" && typeof keyCode === "number") {
                        editor.addCommand(
                          keyMod | keyCode,
                          () => void runAggregate()
                        );
                      }
                    }}
                  />
                  <div title={t("query.resize.title")} style={resizeHandleStyle}
                    onMouseDown={startAggResize} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "10px", marginBottom: "12px" }}>
                  <button
                    onClick={() => void runAggregate()}
                    disabled={aggLoading}
                    aria-busy={aggLoading}
                    style={{ background: aggLoading ? "#94a3b8" : "#2563eb", color: "#fff", padding: "6px 16px", borderRadius: "6px", fontSize: "13px", border: "none", cursor: aggLoading ? "not-allowed" : "pointer", fontFamily: FONT, fontWeight: 600 }}
                  >
                    {aggLoading ? `⏳ ${t("aggregate.button.running")}` : t("aggregate.button.run")}
                  </button>
                  <span style={{ fontSize: "11px", color: "#94a3b8", fontFamily: FONT }}>{t("aggregate.hint.ctrlEnter")}</span>
                  {aggResults.length > 0 && !aggError && !aggLoading && (
                    <span style={{ fontSize: "12px", color: "#16a34a", fontWeight: 600 }}>
                      {t("aggregate.results.count", { count: aggResults.length })}
                    </span>
                  )}
                  {!aggLoading && aggDuration !== null && !aggError && (
                    <span style={{ fontSize: "11px", color: "#64748b", fontFamily: FONT, marginLeft: "auto" }}>
                      {t("query.duration", { duration: formatDuration(aggDuration) })}
                    </span>
                  )}
                </div>
                {aggError && (
                  <div style={{
                    marginBottom: "12px", background: "#fef2f2", border: "1px solid #fca5a5",
                    borderRadius: "6px", padding: "10px 14px", fontSize: "13px", color: "#dc2626",
                    fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}>
                    {aggError}
                  </div>
                )}
              </div>
              {/* Results — fill remaining height */}
              {aggResults.length > 0 && (
                <div style={{ flex: 1, overflow: "hidden", borderTop: "1px solid #e2e8f0" }}>
                  <Editor theme={editorTheme}
                    height="100%"
                    defaultLanguage="json"
                    value={JSON.stringify(aggResults, null, 2)}
                    options={{
                      readOnly: true,
                      minimap: { enabled: false },
                      lineNumbers: "on" as const,
                      folding: true,
                      scrollBeyondLastLine: false,
                      fontSize: 12,
                      wordWrap: "off" as const,
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* ── Update tab ── */}
          {view === "update" && canWrite && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: FONT }}>
              <div style={{ padding: "16px 20px 0", flexShrink: 0 }}>
                <p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 8px 0" }}>
                  {t("update.prompt")}
                </p>
                <div style={{ border: "1px solid #e2e8f0", borderRadius: "6px", overflow: "hidden" }}>
                  <Editor theme={editorTheme}
                    height={`${aggHeight}px`}
                    defaultLanguage="json"
                    path={`dbv://update/${tabId}`}
                    value={updateManyText}
                    onChange={(v) => setUpdateManyText(v ?? "")}
                    options={{
                      minimap: { enabled: false },
                      lineNumbers: "off" as const,
                      folding: false,
                      scrollBeyondLastLine: false,
                      fontSize: 13,
                      padding: { top: 6, bottom: 6 },
                      wordWrap: "on" as const,
                      suggest: { showSnippets: true, showWords: false },
                      quickSuggestions: { other: true, comments: false, strings: true },
                    }}
                    onMount={(editor, monaco) => {
                      const keyMod = monaco?.KeyMod?.CtrlCmd;
                      const keyCode = monaco?.KeyCode?.Enter;
                      if (typeof keyMod === "number" && typeof keyCode === "number") {
                        editor.addCommand(
                          keyMod | keyCode,
                          () => void runUpdateMany()
                        );
                      }
                    }}
                  />
                  <div title={t("query.resize.title")} style={resizeHandleStyle}
                    onMouseDown={startAggResize} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "10px", marginBottom: "12px" }}>
                  <button
                    onClick={() => void runUpdateMany()}
                    disabled={updateManyLoading}
                    aria-busy={updateManyLoading}
                    style={{ background: updateManyLoading ? "#94a3b8" : "#2563eb", color: "#fff", padding: "6px 16px", borderRadius: "6px", fontSize: "13px", border: "none", cursor: updateManyLoading ? "not-allowed" : "pointer", fontFamily: FONT, fontWeight: 600 }}
                  >
                    {updateManyLoading ? `⏳ ${t("update.button.running")}` : t("update.button.run")}
                  </button>
                  <span style={{ fontSize: "11px", color: "#94a3b8", fontFamily: FONT }}>{t("update.hint.ctrlEnter")}</span>
                  {!updateManyLoading && updateManyDuration !== null && !updateManyError && (
                    <span style={{ fontSize: "11px", color: "#64748b", fontFamily: FONT, marginLeft: "auto" }}>
                      {t("query.duration", { duration: formatDuration(updateManyDuration) })}
                    </span>
                  )}
                </div>
                {updateManyError && (
                  <div style={{
                    marginBottom: "12px", background: "#fef2f2", border: "1px solid #fca5a5",
                    borderRadius: "6px", padding: "10px 14px", fontSize: "13px", color: "#dc2626",
                    fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}>
                    {updateManyError}
                  </div>
                )}
              </div>
              <div style={{ flex: 1, overflow: "hidden", borderTop: "1px solid #e2e8f0" }}>
                <Editor theme={editorTheme}
                  height="100%"
                  defaultLanguage="json"
                  value={updateManyResult ? JSON.stringify(updateManyResult, null, 2) : t("update.placeholder.result")}
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    lineNumbers: "on" as const,
                    folding: true,
                    scrollBeyondLastLine: false,
                    fontSize: 12,
                    wordWrap: "off" as const,
                  }}
                />
              </div>
            </div>
          )}

          {/* ── Delete tab ── */}
          {view === "delete" && canWrite && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: FONT }}>
              <div style={{ padding: "16px 20px 0", flexShrink: 0 }}>
                <p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 8px 0" }}>
                  {t("delete.prompt")}
                </p>
                <div style={{ border: "1px solid #e2e8f0", borderRadius: "6px", overflow: "hidden" }}>
                  <Editor theme={editorTheme}
                    height={`${aggHeight}px`}
                    defaultLanguage="json"
                    path={`dbv://delete/${tabId}`}
                    value={deleteManyText}
                    onChange={(v) => setDeleteManyText(v ?? "")}
                    options={{
                      minimap: { enabled: false },
                      lineNumbers: "off" as const,
                      folding: false,
                      scrollBeyondLastLine: false,
                      fontSize: 13,
                      padding: { top: 6, bottom: 6 },
                      wordWrap: "on" as const,
                      suggest: { showSnippets: true, showWords: false },
                      quickSuggestions: { other: true, comments: false, strings: true },
                    }}
                    onMount={(editor, monaco) => {
                      const keyMod = monaco?.KeyMod?.CtrlCmd;
                      const keyCode = monaco?.KeyCode?.Enter;
                      if (typeof keyMod === "number" && typeof keyCode === "number") {
                        editor.addCommand(
                          keyMod | keyCode,
                          () => void runDeleteMany()
                        );
                      }
                    }}
                  />
                  <div title={t("query.resize.title")} style={resizeHandleStyle}
                    onMouseDown={startAggResize} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "10px", marginBottom: "12px" }}>
                  <button
                    onClick={() => void runDeleteMany()}
                    disabled={deleteManyLoading}
                    aria-busy={deleteManyLoading}
                    style={{ background: deleteManyLoading ? "#94a3b8" : "#2563eb", color: "#fff", padding: "6px 16px", borderRadius: "6px", fontSize: "13px", border: "none", cursor: deleteManyLoading ? "not-allowed" : "pointer", fontFamily: FONT, fontWeight: 600 }}
                  >
                    {deleteManyLoading ? `⏳ ${t("delete.button.running")}` : t("delete.button.run")}
                  </button>
                  <span style={{ fontSize: "11px", color: "#94a3b8", fontFamily: FONT }}>{t("delete.hint.ctrlEnter")}</span>
                  {!deleteManyLoading && deleteManyDuration !== null && !deleteManyError && (
                    <span style={{ fontSize: "11px", color: "#64748b", fontFamily: FONT, marginLeft: "auto" }}>
                      {t("query.duration", { duration: formatDuration(deleteManyDuration) })}
                    </span>
                  )}
                </div>
                {deleteManyError && (
                  <div style={{
                    marginBottom: "12px", background: "#fef2f2", border: "1px solid #fca5a5",
                    borderRadius: "6px", padding: "10px 14px", fontSize: "13px", color: "#dc2626",
                    fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}>
                    {deleteManyError}
                  </div>
                )}
              </div>
              <div style={{ flex: 1, overflow: "hidden", borderTop: "1px solid #e2e8f0" }}>
                <Editor theme={editorTheme}
                  height="100%"
                  defaultLanguage="json"
                  value={deleteManyResult ? JSON.stringify(deleteManyResult, null, 2) : t("delete.placeholder.result")}
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    lineNumbers: "on" as const,
                    folding: true,
                    scrollBeyondLastLine: false,
                    fontSize: 12,
                    wordWrap: "off" as const,
                  }}
                />
              </div>
            </div>
          )}

          {/* ── Schema tab ── */}
          {view === "schema" && (
            <div style={{ padding: "20px", fontFamily: FONT }}>
              {schemaLoading ? (
                <p style={{ color: muiTheme.palette.text.secondary, fontSize: "13px" }}>
                  {t("schema.inferring")}
                </p>
              ) : schema ? (
                <SchemaViewer
                  fields={schema.fields}
                  sampledDocs={schema.sampled_documents}
                />
              ) : (
                <p style={{ color: muiTheme.palette.text.secondary, fontSize: "13px" }}>
                  {t("schema.unavailable")}
                </p>
              )}
            </div>
          )}

          {/* ── Indexes tab ── */}
          {view === "indexes" && (
            <div style={{ padding: "20px", fontFamily: FONT }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
                <span style={{ fontSize: "13px", color: muiTheme.palette.text.secondary, flex: 1 }}>
                  {indexesLoading ? t("indexes.label.loading") : t("indexes.label.count", { count: indexes.length })}
                </span>
                <button
                  onClick={() => { setIndexName(""); setIndexKeys([{ field: "", direction: 1 }]); setIndexUnique(false); setIndexSparse(false); setIndexBackground(true); setIndexTtl(""); setIndexPartialFilter(""); setNewIndexOpen(true); }}
                  style={{ padding: "6px 14px", background: muiTheme.palette.primary.main, color: muiTheme.palette.primary.contrastText, border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}
                >
                  {t("indexes.button.create")}
                </button>
              </div>

              {indexes.length === 0 && !indexesLoading ? (
                <p style={{ color: muiTheme.palette.text.secondary, fontSize: "13px" }}>{t("indexes.list.empty")}</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr style={{ background: muiTheme.palette.action.hover, borderBottom: `2px solid ${muiTheme.palette.divider}` }}>
                        {[t("table.header.name"), t("table.header.keys"), t("table.header.unique"), t("table.header.sparse"), t("table.header.ttl"), t("table.header.partialFilter"), ""].map((h) => (
                          <th key={h} style={{ padding: "8px 12px", textAlign: [t("table.header.unique"), t("table.header.sparse"), t("table.header.ttl")].includes(h) ? "center" : "left", color: muiTheme.palette.text.secondary, fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {indexes.map((idx) => (
                        <tr key={idx.name} style={{ borderBottom: `1px solid ${muiTheme.palette.divider}` }}>
                          <td style={{ padding: "8px 12px", color: muiTheme.palette.text.primary, fontWeight: 500, textAlign: "left" }}>{idx.name}</td>
                          <td style={{ padding: "8px 12px", textAlign: "left" }}>
                            <code style={{ background: muiTheme.palette.action.hover, padding: "2px 6px", borderRadius: "4px", fontSize: "12px", color: muiTheme.palette.text.primary }}>
                              {Object.entries(idx.keys).map(([f, d]) => `${f}: ${d}`).join(", ")}
                            </code>
                          </td>
                          <td style={{ padding: "8px 12px", textAlign: "center", color: idx.unique ? muiTheme.palette.success.main : muiTheme.palette.text.secondary }}>
                            {idx.unique ? "✓" : "—"}
                          </td>
                          <td style={{ padding: "8px 12px", textAlign: "center", color: idx.sparse ? muiTheme.palette.success.main : muiTheme.palette.text.secondary }}>
                            {idx.sparse ? "✓" : "—"}
                          </td>
                          <td style={{ padding: "8px 12px", textAlign: "center", color: muiTheme.palette.text.secondary }}>
                            {idx.ttl !== undefined ? idx.ttl : "—"}
                          </td>
                          <td style={{ padding: "8px 12px", textAlign: "left", maxWidth: "200px" }}>
                            {idx.partialFilterExpression ? (
                              <code style={{ background: muiTheme.palette.action.hover, padding: "2px 6px", borderRadius: "4px", fontSize: "11px", color: muiTheme.palette.text.primary, wordBreak: "break-word" }}>
                                {JSON.stringify(idx.partialFilterExpression)}
                              </code>
                            ) : (
                              <span style={{ color: muiTheme.palette.text.secondary }}>—</span>
                            )}
                          </td>
                          <td style={{ padding: "8px 12px", textAlign: "center" }}>
                            {idx.name !== "_id_" && (
                              <button
                                onClick={() => {
                                  if (!confirm(t("modals.confirmDrop.index", { name: idx.name }))) return;
                                  dropIndex(db, col, idx.name)
                                    .then(loadIndexes)
                                    .catch((e: unknown) => alert("Error: " + (e as Error).message));
                                }}
                                style={{ padding: "3px 10px", background: muiTheme.palette.background.paper, border: `1px solid ${muiTheme.palette.error.main}`, color: muiTheme.palette.error.main, borderRadius: "5px", cursor: "pointer", fontSize: "12px", fontWeight: 500 }}
                              >
                                {t("buttons.drop")}
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
                <p style={{ color: muiTheme.palette.text.secondary, fontSize: "13px" }}>{t("stats.loading")}</p>
              ) : !colStats ? (
                <p style={{ color: muiTheme.palette.text.secondary, fontSize: "13px" }}>{t("stats.unavailable")}</p>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
                    <span style={{ fontSize: "13px", color: muiTheme.palette.text.secondary, flex: 1 }}>{t("stats.title")}</span>
                    <button onClick={loadColStats} style={{ padding: "5px 12px", background: muiTheme.palette.background.paper, border: `1px solid ${muiTheme.palette.divider}`, borderRadius: "6px", cursor: "pointer", fontSize: "12px", color: muiTheme.palette.text.primary, fontFamily: FONT }}>{t("buttons.refresh")}</button>
                  </div>
                  {(() => {
                    const s = colStats;
                    const cards: { label: string; value: string; sub?: string }[] = [
                      { label: t("stats.label.documents"),  value: numVal(s["count"]).toLocaleString() },
                      { label: t("stats.label.avgDocSize"), value: formatBytes(numVal(s["avgObjSize"])) },
                      { label: t("stats.label.dataSize"),   value: formatBytes(numVal(s["size"])) },
                      { label: t("stats.label.storageSize"),value: formatBytes(numVal(s["storageSize"])) },
                      { label: t("stats.label.indexes"),    value: numVal(s["nindexes"]).toLocaleString() },
                      { label: t("stats.label.indexSize"),  value: formatBytes(numVal(s["totalIndexSize"])) },
                    ];
                    return (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "12px", marginBottom: "24px" }}>
                        {cards.map((c) => (
                          <div key={c.label} style={{ background: muiTheme.palette.background.paper, border: `1px solid ${muiTheme.palette.divider}`, borderRadius: "8px", padding: "14px 16px" }}>
                            <div style={{ fontSize: "11px", fontWeight: 600, color: muiTheme.palette.text.secondary, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>{c.label}</div>
                            <div style={{ fontSize: "22px", fontWeight: 700, color: muiTheme.palette.text.primary }}>{c.value}</div>
                            {c.sub && <div style={{ fontSize: "11px", color: muiTheme.palette.text.secondary, marginTop: "2px" }}>{c.sub}</div>}
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  {colStats["indexSizes"] && typeof colStats["indexSizes"] === "object" && (
                    <>
                      <h4 style={{ fontSize: "13px", fontWeight: 600, color: muiTheme.palette.text.primary, margin: "0 0 10px 0" }}>{t("stats.section.indexSizes")}</h4>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                        <thead>
                          <tr style={{ background: muiTheme.palette.action.hover, borderBottom: `2px solid ${muiTheme.palette.divider}` }}>
                            <th style={{ padding: "6px 12px", textAlign: "left", color: muiTheme.palette.text.secondary, fontWeight: 600 }}>{t("table.header.index")}</th>
                            <th style={{ padding: "6px 12px", textAlign: "right", color: muiTheme.palette.text.secondary, fontWeight: 600 }}>{t("table.header.size")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(colStats["indexSizes"] as Record<string, unknown>).map(([name, size]) => (
                            <tr key={name} style={{ borderBottom: `1px solid ${muiTheme.palette.divider}` }}>
                              <td style={{ padding: "6px 12px", color: muiTheme.palette.text.primary, textAlign: "left" }}>
                                <code style={{ background: muiTheme.palette.action.hover, color: muiTheme.palette.text.primary, padding: "1px 5px", borderRadius: "3px", fontSize: "12px" }}>{name}</code>
                              </td>
                              <td style={{ padding: "6px 12px", textAlign: "right", color: muiTheme.palette.text.secondary }}>{formatBytes(numVal(size))}</td>
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
          <div
            style={{
              flex: 1,
              overflow: "hidden",
              display: view === "commands" ? "flex" : "none",
              flexDirection: "column",
            }}
          >
            <CommandsView db={db} collection={col} tabId={tabId} />
          </div>
        </div>
      )}

      {/* ── Editor modal ── */}
      {editorOpen && (
        <div style={overlayStyle}>
          <div style={{ ...modalBaseStyle, width: "min(900px, 92vw)", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
            {/* Header row: title + Form/JSON toggle */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <h3 style={{ ...modalTitleStyle, marginBottom: 0 }}>
                {editingId ? t("modals.editDocument.title") : t("modals.newDocument.title")}
              </h3>
              <div style={{ display: "flex", background: muiTheme.palette.action.selected, borderRadius: 6, border: `1px solid ${muiTheme.palette.divider}`, overflow: "hidden" }}>
                {(["form", "json"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setEditorMode(m)}
                    style={{
                      padding: "4px 14px",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      border: "none",
                      background: editorMode === m ? muiTheme.palette.primary.main : "transparent",
                      color: editorMode === m ? muiTheme.palette.primary.contrastText : muiTheme.palette.text.secondary,
                      transition: "background 0.15s",
                    }}
                  >
                    {m === "form" ? t("buttons.form") : t("buttons.json")}
                  </button>
                ))}
              </div>
            </div>
            <p style={modalSubtitleStyle}>
              {editorMode === "form"
                ? t("editor.mode.form.subtitle")
                : t("editor.mode.json.subtitle")}
            </p>

            {editorMode === "form" ? (
              <DocFormEditor
                schema={schema}
                value={editorValue}
                onChange={setEditorValue}
                isEditing={editingId !== null}
              />
            ) : (
              <Editor theme={editorTheme}
                height="500px"
                defaultLanguage="json"
                path={`dbv://document/${tabId}`}
                value={editorValue}
                onChange={(v) => setEditorValue(v ?? "{}")}
              />
            )}

            <div style={modalFooterStyle}>
              <button
                onClick={() => setEditorOpen(false)}
                style={cancelBtnStyle}
              >
                {t("buttons.cancel")}
              </button>
              <button onClick={() => void handleSave()} style={primaryBtnStyle}>
                {t("buttons.save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Import confirmation modal ── */}
      {importModalOpen && importPending && (
        <div style={overlayStyle} role="dialog" aria-modal="true" aria-labelledby="import-modal-title">
          <div style={{ ...modalBaseStyle, width: "460px" }}>
            <h3 id="import-modal-title" style={modalTitleStyle}>{t("modals.import.title")}</h3>
            <p style={modalSubtitleStyle}>
              {importPending.kind === "json"
                ? t("modals.import.subtitleJson", { count: importPending.docs.length, filename: importPending.filename })
                : t("modals.import.subtitleBson", { filename: importPending.filename })}
            </p>
            <label style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "13px", color: "#374151", cursor: "pointer", marginBottom: "20px" }}>
              <input
                type="checkbox"
                checked={importReplace}
                onChange={(e) => setImportReplace(e.target.checked)}
              />
              {t("modals.import.replaceLabel")}
            </label>
            <div style={modalFooterStyle}>
              <button
                onClick={() => { setImportModalOpen(false); setImportPending(null); }}
                style={cancelBtnStyle}
              >
                {t("buttons.cancel")}
              </button>
              <button
                onClick={() => void handleImportConfirm()}
                style={primaryBtnStyle}
              >
                {t("modals.import.button.import")}
              </button>
            </div>
          </div>
        </div>
      )}
      {newIndexOpen && (
        <div style={overlayStyle}>
          <div style={{ ...modalBaseStyle, width: "560px" }}>
            <h3 style={modalTitleStyle}>{t("modals.createIndex.title")}</h3>
            <p style={modalSubtitleStyle}>
              {t("modals.createIndex.subtitle")}
            </p>

            <label style={modalLabelStyle}>{t("modals.createIndex.label.keys")}</label>
            {indexKeys.map((k, i) => (
              <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "8px", alignItems: "center" }}>
                <input
                  style={{ ...modalInputStyle, flex: 2, marginBottom: 0 }}
                  placeholder={t("modals.createIndex.placeholder.fieldName")}
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
                  <option value={1}>{t("modals.createIndex.option.ascending")}</option>
                  <option value={-1}>{t("modals.createIndex.option.descending")}</option>
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
              {t("modals.createIndex.button.addField")}
            </button>

            <label style={modalLabelStyle}>{t("modals.createIndex.label.name")} <span style={{ fontWeight: 400, color: "#94a3b8" }}>{t("modals.createIndex.optional")}</span></label>
            <input
              style={modalInputStyle}
              placeholder={t("modals.createIndex.placeholder.name")}
              value={indexName}
              onChange={(e) => setIndexName(e.target.value)}
            />

            <div style={{ display: "flex", gap: "24px", marginBottom: "16px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#374151", cursor: "pointer" }}>
                <input type="checkbox" checked={indexUnique} onChange={(e) => setIndexUnique(e.target.checked)} />
                {t("modals.createIndex.label.unique")}
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#374151", cursor: "pointer" }}>
                <input type="checkbox" checked={indexSparse} onChange={(e) => setIndexSparse(e.target.checked)} />
                {t("modals.createIndex.label.sparse")}
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#374151", cursor: "pointer" }}>
                <input type="checkbox" checked={indexBackground} onChange={(e) => setIndexBackground(e.target.checked)} />
                <span>
                  {t("modals.createIndex.label.background")}
                  <span style={{ fontSize: "11px", color: "#94a3b8", marginLeft: "4px" }}>{t("modals.createIndex.hint.background")}</span>
                </span>
              </label>
            </div>

            <label style={modalLabelStyle}>{t("modals.createIndex.label.ttl")} <span style={{ fontWeight: 400, color: "#94a3b8" }}>{t("modals.createIndex.hint.ttl")}</span></label>
            <input
              style={modalInputStyle}
              placeholder={t("modals.createIndex.placeholder.ttl")}
              type="number"
              value={indexTtl}
              onChange={(e) => setIndexTtl(e.target.value)}
            />

            <label style={modalLabelStyle}>{t("modals.createIndex.label.partialFilter")} <span style={{ fontWeight: 400, color: "#94a3b8" }}>{t("modals.createIndex.optional")}</span></label>
            <textarea
              style={{ ...modalInputStyle, fontFamily: "monospace", fontSize: "12px", resize: "vertical", minHeight: "60px" }}
              placeholder={t("modals.createIndex.placeholder.partialFilter")}
              value={indexPartialFilter}
              onChange={(e) => setIndexPartialFilter(e.target.value)}
            />

            <div style={modalFooterStyle}>
              <button onClick={() => setNewIndexOpen(false)} style={cancelBtnStyle}>{t("buttons.cancel")}</button>
              <button
                onClick={() => {
                  const keys = Object.fromEntries(
                    indexKeys.filter((k) => k.field.trim()).map((k) => [k.field.trim(), k.direction])
                  ) as Record<string, 1 | -1>;
                  if (Object.keys(keys).length === 0) { alert(t("modals.createIndex.validation.fieldRequired")); return; }
                  let partialFilterExpr: Record<string, unknown> | undefined;
                  if (indexPartialFilter.trim()) {
                    try {
                      partialFilterExpr = JSON.parse(indexPartialFilter) as Record<string, unknown>;
                    } catch {
                      alert(t("modals.createIndex.validation.partialFilterInvalid"));
                      return;
                    }
                  }
                  createIndex(db, col, keys, {
                    name: indexName.trim() || undefined,
                    unique: indexUnique || undefined,
                    sparse: indexSparse || undefined,
                    background: indexBackground,
                    ttl: indexTtl ? Number(indexTtl) : undefined,
                    partial_filter_expression: partialFilterExpr,
                  })
                    .then(() => { setNewIndexOpen(false); loadIndexes(); })
                    .catch((e: unknown) => alert("Error: " + (e as Error).message));
                }}
                style={primaryBtnStyle}
              >
                {t("modals.createIndex.button.submit")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
