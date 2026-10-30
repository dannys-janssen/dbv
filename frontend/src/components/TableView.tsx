import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "@mui/material/styles";
import Editor, { loader } from "@monaco-editor/react";
import {
  getDocuments,
  getSchema,
  listIndexes,
  getCollectionStats,
  runSqlQuery,
  type CollectionSchema,
  type IndexInfo,
  type QueryResult,
} from "../api/mongo";
import SchemaViewer from "./SchemaViewer";
import { registerDbvMonacoThemes, type MonacoWithDefineTheme } from "../utils/monacoTheme";
import { getTotalPages, hasNextPage, parsePageInput } from "../utils/pagination";
import { columnsForRows, formatBytes, formatCell, parseJsonField } from "../utils/sqlTable";

type View = "rows" | "schema" | "indexes" | "stats" | "sql";

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Courier New", monospace';

interface Props {
  db: string;
  table: string;
  visible: boolean;
  tabId: string;
}

export default function TableView({ db, table, visible, tabId }: Props) {
  const { t } = useTranslation();
  const muiTheme = useTheme();
  const isDark = muiTheme.palette.mode === "dark";
  const [monacoReady, setMonacoReady] = useState(false);

  const [view, setView] = useState<View>("rows");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [pageInput, setPageInput] = useState("1");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [filterText, setFilterText] = useState("");
  const [sortText, setSortText] = useState("");
  const [projectionText, setProjectionText] = useState("");
  const [appliedFilter, setAppliedFilter] = useState("");
  const [appliedSort, setAppliedSort] = useState("");
  const [appliedProjection, setAppliedProjection] = useState("");

  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);

  const [schema, setSchema] = useState<CollectionSchema | null>(null);
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);

  const [sql, setSql] = useState("");
  const [sqlResult, setSqlResult] = useState<QueryResult | null>(null);
  const [sqlError, setSqlError] = useState("");
  const [sqlRunning, setSqlRunning] = useState(false);

  useEffect(() => {
    void loader.init().then((monaco) => {
      registerDbvMonacoThemes(monaco as unknown as MonacoWithDefineTheme);
      setMonacoReady(true);
    });
  }, []);

  const editorTheme = monacoReady ? (isDark ? "dbv-dark" : "dbv-light") : isDark ? "vs-dark" : "vs";

  const apiError = useCallback(
    (e: unknown): string =>
      (e as { response?: { data?: { error?: string } } }).response?.data?.error ??
      (e as Error).message ??
      "Request failed",
    []
  );

  const loadRows = useCallback(async () => {
    if (!db || !table) return;
    setLoading(true);
    setError("");
    try {
      const data = await getDocuments(
        db,
        table,
        page,
        limit,
        appliedFilter || undefined,
        appliedSort || undefined,
        appliedProjection || undefined
      );
      setRows(data.documents);
      setColumns(columnsForRows(data.columns, data.documents));
      setTotal(data.total);
    } catch (e: unknown) {
      setError(apiError(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [db, table, page, limit, appliedFilter, appliedSort, appliedProjection, apiError]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: sets loading before async fetch
    if (visible && view === "rows") void loadRows();
  }, [visible, view, loadRows]);

  const goToPage = useCallback((next: number) => {
    setPage(next);
    setPageInput(String(next));
  }, []);

  useEffect(() => {
    if (!visible || !db || !table) return;
    if (view === "schema" && !schema) {
      getSchema(db, table).then(setSchema).catch((e) => setError(apiError(e)));
    }
    if (view === "indexes") {
      listIndexes(db, table)
        .then((d) => setIndexes(d.indexes))
        .catch((e) => setError(apiError(e)));
    }
    if (view === "stats") {
      getCollectionStats(db, table).then(setStats).catch((e) => setError(apiError(e)));
    }
  }, [visible, view, db, table, schema, apiError]);

  const applyQuery = () => {
    const parsed = [filterText, sortText, projectionText].map(parseJsonField);
    if (parsed.some((p) => p === null)) {
      setError(t("table.query.invalidJson"));
      return;
    }
    setError("");
    setAppliedFilter(filterText.trim());
    setAppliedSort(sortText.trim());
    setAppliedProjection(projectionText.trim());
    goToPage(1);
  };

  const resetQuery = () => {
    setFilterText("");
    setSortText("");
    setProjectionText("");
    setAppliedFilter("");
    setAppliedSort("");
    setAppliedProjection("");
    setError("");
    goToPage(1);
  };

  const runSql = useCallback(async () => {
    if (!sql.trim()) return;
    setSqlRunning(true);
    setSqlError("");
    try {
      setSqlResult(await runSqlQuery(db, sql));
    } catch (e: unknown) {
      setSqlError(apiError(e));
      setSqlResult(null);
    } finally {
      setSqlRunning(false);
    }
  }, [db, sql, apiError]);

  const totalPages = getTotalPages(total, limit);
  const statEntries = useMemo(
    () => (stats ? Object.entries(stats) : []),
    [stats]
  );

  const border = muiTheme.palette.divider;
  const text = muiTheme.palette.text.primary;
  const muted = muiTheme.palette.text.secondary;
  const surface = muiTheme.palette.background.paper;

  const inputStyle: React.CSSProperties = {
    padding: "6px 8px",
    borderRadius: 6,
    border: `1px solid ${border}`,
    background: surface,
    color: text,
    fontSize: 12,
    fontFamily: MONO,
    minWidth: 0,
  };

  const btnStyle: React.CSSProperties = {
    padding: "6px 12px",
    borderRadius: 6,
    border: `1px solid ${border}`,
    background: surface,
    color: text,
    cursor: "pointer",
    fontSize: 12,
    fontFamily: FONT,
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "8px 14px",
    border: "none",
    borderBottom: active ? `2px solid ${muiTheme.palette.primary.main}` : "2px solid transparent",
    background: "none",
    color: active ? text : muted,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    fontFamily: FONT,
  });

  const thStyle: React.CSSProperties = {
    textAlign: "left",
    padding: "6px 10px",
    borderBottom: `1px solid ${border}`,
    color: muted,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    whiteSpace: "nowrap",
    fontFamily: FONT,
  };

  const tdStyle: React.CSSProperties = {
    padding: "6px 10px",
    borderBottom: `1px solid ${border}`,
    color: text,
    fontSize: 12,
    fontFamily: MONO,
    maxWidth: 320,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  if (!db || !table) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: muted, fontFamily: FONT }}>
        <div style={{ fontSize: 32, marginBottom: 8 }} aria-hidden="true">
          🗄
        </div>
        <p>{t("table.empty.selectTable")}</p>
      </div>
    );
  }

  const renderGrid = (cols: string[], data: Record<string, unknown>[], clickable: boolean) => (
    <div style={{ overflow: "auto", flex: 1 }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c} style={thStyle} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={i}
              onClick={clickable ? () => setSelectedRow(row) : undefined}
              style={{ cursor: clickable ? "pointer" : "default" }}
            >
              {cols.map((c) => (
                <td key={c} style={tdStyle} title={formatCell(row[c])}>
                  {formatCell(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.length === 0 && !loading && (
        <p style={{ color: muted, fontSize: 13, padding: 20, fontFamily: FONT }}>
          {t("table.rows.empty")}
        </p>
      )}
    </div>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div
        role="tablist"
        aria-label={t("table.tabs.label")}
        style={{ display: "flex", gap: 4, borderBottom: `1px solid ${border}`, flexShrink: 0 }}
      >
        {(["rows", "schema", "indexes", "stats", "sql"] as View[]).map((v) => (
          <button
            key={v}
            role="tab"
            id={`${tabId}-tab-${v}`}
            aria-selected={view === v}
            aria-controls={`${tabId}-panel-${v}`}
            onClick={() => setView(v)}
            style={tabStyle(view === v)}
          >
            {t(`table.tabs.${v}`)}
          </button>
        ))}
        <span
          style={{
            marginLeft: "auto",
            alignSelf: "center",
            padding: "0 12px",
            fontSize: 11,
            color: muted,
            fontFamily: FONT,
          }}
        >
          {t("table.readOnlyBadge")}
        </span>
      </div>

      {error && (
        <p
          role="alert"
          style={{ color: "#dc2626", fontSize: 13, margin: 0, padding: "8px 12px", fontFamily: FONT }}
        >
          {error}
        </p>
      )}

      {view === "rows" && (
        <div
          role="tabpanel"
          id={`${tabId}-panel-rows`}
          aria-labelledby={`${tabId}-tab-rows`}
          aria-busy={loading}
          style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}
        >
          <div
            style={{
              display: "flex",
              gap: 8,
              padding: "8px 12px",
              alignItems: "flex-end",
              flexWrap: "wrap",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 2, minWidth: 180 }}>
              <label htmlFor={`${tabId}-filter`} style={{ fontSize: 11, color: muted, fontFamily: FONT }}>
                {t("table.query.filter")}
              </label>
              <input
                id={`${tabId}-filter`}
                style={inputStyle}
                placeholder='{"id": 1}'
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyQuery()}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 120 }}>
              <label htmlFor={`${tabId}-sort`} style={{ fontSize: 11, color: muted, fontFamily: FONT }}>
                {t("table.query.sort")}
              </label>
              <input
                id={`${tabId}-sort`}
                style={inputStyle}
                placeholder='{"id": -1}'
                value={sortText}
                onChange={(e) => setSortText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyQuery()}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 120 }}>
              <label htmlFor={`${tabId}-projection`} style={{ fontSize: 11, color: muted, fontFamily: FONT }}>
                {t("table.query.projection")}
              </label>
              <input
                id={`${tabId}-projection`}
                style={inputStyle}
                placeholder='{"name": 1}'
                value={projectionText}
                onChange={(e) => setProjectionText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyQuery()}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, width: 80 }}>
              <label htmlFor={`${tabId}-limit`} style={{ fontSize: 11, color: muted, fontFamily: FONT }}>
                {t("table.query.limit")}
              </label>
              <input
                id={`${tabId}-limit`}
                type="number"
                min={1}
                max={1000}
                style={inputStyle}
                value={limit}
                onChange={(e) => {
                  setLimit(Math.max(1, Math.min(1000, Number(e.target.value) || 20)));
                  goToPage(1);
                }}
              />
            </div>
            <button onClick={applyQuery} style={btnStyle}>
              {t("table.query.apply")}
            </button>
            <button onClick={resetQuery} style={btnStyle}>
              {t("table.query.reset")}
            </button>
          </div>

          {renderGrid(columns, rows, true)}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              borderTop: `1px solid ${border}`,
              flexShrink: 0,
              fontSize: 12,
              color: muted,
              fontFamily: FONT,
            }}
          >
            <span>{t("table.rows.total", { count: total })}</span>
            <button
              onClick={() => goToPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              style={{ ...btnStyle, opacity: page <= 1 ? 0.5 : 1 }}
              aria-label={t("table.rows.prevPage")}
            >
              ‹
            </button>
            <label htmlFor={`${tabId}-page`} className="sr-only">
              {t("table.rows.pageLabel")}
            </label>
            <input
              id={`${tabId}-page`}
              style={{ ...inputStyle, width: 56, textAlign: "center" }}
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const next = parsePageInput(pageInput, totalPages);
                if (next === null) setPageInput(String(page));
                else goToPage(next);
              }}
            />
            <span>/ {totalPages}</span>
            <button
              onClick={() => goToPage(page + 1)}
              disabled={!hasNextPage(page, total, limit)}
              style={{ ...btnStyle, opacity: hasNextPage(page, total, limit) ? 1 : 0.5 }}
              aria-label={t("table.rows.nextPage")}
            >
              ›
            </button>
          </div>
        </div>
      )}

      {view === "schema" && (
        <div
          role="tabpanel"
          id={`${tabId}-panel-schema`}
          aria-labelledby={`${tabId}-tab-schema`}
          style={{ flex: 1, overflow: "auto" }}
        >
          {schema ? (
            <SchemaViewer fields={schema.fields} sampledDocs={schema.sampled_documents} />
          ) : (
            <p style={{ color: muted, fontSize: 13, padding: 20, fontFamily: FONT }}>{t("ui.loading")}</p>
          )}
        </div>
      )}

      {view === "indexes" && (
        <div
          role="tabpanel"
          id={`${tabId}-panel-indexes`}
          aria-labelledby={`${tabId}-tab-indexes`}
          style={{ flex: 1, overflow: "auto", padding: "0 12px" }}
        >
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={thStyle} scope="col">{t("table.indexes.name")}</th>
                <th style={thStyle} scope="col">{t("table.indexes.columns")}</th>
                <th style={thStyle} scope="col">{t("table.indexes.unique")}</th>
              </tr>
            </thead>
            <tbody>
              {indexes.map((idx) => (
                <tr key={idx.name}>
                  <td style={tdStyle}>{idx.name}</td>
                  <td style={tdStyle}>{Object.keys(idx.keys).join(", ")}</td>
                  <td style={tdStyle}>{idx.unique ? "✓" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === "stats" && (
        <div
          role="tabpanel"
          id={`${tabId}-panel-stats`}
          aria-labelledby={`${tabId}-tab-stats`}
          style={{ flex: 1, overflow: "auto", padding: 12 }}
        >
          {statEntries.length === 0 ? (
            <p style={{ color: muted, fontSize: 13, fontFamily: FONT }}>{t("ui.loading")}</p>
          ) : (
            <table style={{ borderCollapse: "collapse" }}>
              <tbody>
                {statEntries.map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ ...tdStyle, color: muted, fontFamily: FONT }}>{k}</td>
                    <td style={tdStyle}>
                      {typeof v === "number" && /size|length/i.test(k) ? formatBytes(v) : formatCell(v)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {view === "sql" && (
        <div
          role="tabpanel"
          id={`${tabId}-panel-sql`}
          aria-labelledby={`${tabId}-tab-sql`}
          style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}
        >
          <p style={{ color: muted, fontSize: 12, margin: 0, padding: "8px 12px", fontFamily: FONT }}>
            {t("table.sql.hint")}
          </p>
          <div style={{ height: 160, flexShrink: 0, borderBottom: `1px solid ${border}` }}>
            <Editor
              height="160px"
              language="sql"
              theme={editorTheme}
              path={`dbv://sql/${tabId}`}
              value={sql}
              onChange={(v) => setSql(v ?? "")}
              options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false }}
              onMount={(editor, monaco) => {
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
                  void runSql();
                });
              }}
            />
          </div>
          <div style={{ display: "flex", gap: 8, padding: "8px 12px", alignItems: "center", flexShrink: 0 }}>
            <button
              onClick={() => void runSql()}
              disabled={sqlRunning || !sql.trim()}
              style={{ ...btnStyle, opacity: sqlRunning || !sql.trim() ? 0.6 : 1 }}
            >
              {sqlRunning ? t("ui.loading") : t("table.sql.run")}
            </button>
            {sqlResult?.truncated && (
              <span role="status" style={{ fontSize: 12, color: "#d97706", fontFamily: FONT }}>
                {t("table.sql.truncated")}
              </span>
            )}
          </div>
          {sqlError && (
            <p
              role="alert"
              style={{ color: "#dc2626", fontSize: 13, margin: 0, padding: "0 12px 8px", fontFamily: FONT }}
            >
              {sqlError}
            </p>
          )}
          {sqlResult && renderGrid(sqlResult.columns, sqlResult.rows, false)}
        </div>
      )}

      {selectedRow && (
        <div
          role="presentation"
          onClick={() => setSelectedRow(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("table.rowDetail.title")}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: surface,
              color: text,
              borderRadius: 8,
              padding: 16,
              maxWidth: "80vw",
              maxHeight: "80vh",
              overflow: "auto",
              border: `1px solid ${border}`,
            }}
          >
            <h3 style={{ margin: "0 0 12px", fontSize: 14, fontFamily: FONT }}>
              {t("table.rowDetail.title")}
            </h3>
            <pre style={{ margin: 0, fontSize: 12, fontFamily: MONO, whiteSpace: "pre-wrap" }}>
              {JSON.stringify(selectedRow, null, 2)}
            </pre>
            <button onClick={() => setSelectedRow(null)} style={{ ...btnStyle, marginTop: 12 }}>
              {t("buttons.close")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
