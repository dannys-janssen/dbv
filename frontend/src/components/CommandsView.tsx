import { useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import Editor from "@monaco-editor/react";
import { runDbCommand } from "../api/mongo";

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

// ── Command palette ────────────────────────────────────────────────────────────

interface PaletteCommand {
  name: string;
  description: string;
  template: string;
  admin: boolean;
}

interface Category {
  label: string;
  commands: PaletteCommand[];
}

const PALETTE: Category[] = [
  {
    label: "Server",
    commands: [
      { name: "ping",             description: "Test server connectivity",         template: '{\n  "ping": 1\n}',                                                    admin: true  },
      { name: "buildInfo",        description: "Server version and build info",    template: '{\n  "buildInfo": 1\n}',                                               admin: true  },
      { name: "hostInfo",         description: "Host system information",          template: '{\n  "hostInfo": 1\n}',                                                admin: true  },
      { name: "serverStatus",     description: "Runtime statistics",               template: '{\n  "serverStatus": 1\n}',                                            admin: true  },
      { name: "connectionStatus", description: "Current connection details",       template: '{\n  "connectionStatus": 1\n}',                                        admin: false },
      { name: "hello",            description: "Server role / topology info",      template: '{\n  "hello": 1\n}',                                                   admin: true  },
      { name: "listDatabases",    description: "List all databases",               template: '{\n  "listDatabases": 1\n}',                                           admin: true  },
      { name: "currentOp",        description: "In-progress operations",           template: '{\n  "currentOp": 1\n}',                                               admin: true  },
      { name: "killOp",           description: "Kill a running operation by opId", template: '{\n  "killOp": 1,\n  "op": 12345\n}',                                  admin: true  },
      { name: "getLog",           description: "Recent log entries",               template: '{\n  "getLog": "global"\n}',                                           admin: true  },
      { name: "getParameter",     description: "Get a server parameter",           template: '{\n  "getParameter": 1,\n  "maxWireVersion": 1\n}',                    admin: true  },
      { name: "setParameter",     description: "Set a server parameter",           template: '{\n  "setParameter": 1,\n  "logLevel": 1\n}',                          admin: true  },
    ],
  },
  {
    label: "Database",
    commands: [
      { name: "dbStats",          description: "Database storage statistics",      template: '{\n  "dbStats": 1,\n  "scale": 1\n}',                                  admin: false },
      { name: "listCollections",  description: "List collections in this database",template: '{\n  "listCollections": 1\n}',                                         admin: false },
      { name: "usersInfo",        description: "List users",                        template: '{\n  "usersInfo": 1\n}',                                               admin: false },
      { name: "createUser",       description: "Create a database user",           template: '{\n  "createUser": "username",\n  "pwd": "password",\n  "roles": [\n    { "role": "readWrite", "db": "yourdb" }\n  ]\n}', admin: false },
      { name: "dropUser",         description: "Drop a user",                      template: '{\n  "dropUser": "username"\n}',                                       admin: false },
      { name: "grantRolesToUser", description: "Grant roles to a user",            template: '{\n  "grantRolesToUser": "username",\n  "roles": [\n    { "role": "readWrite", "db": "yourdb" }\n  ]\n}', admin: false },
      { name: "revokeRolesFromUser", description: "Revoke roles from a user",      template: '{\n  "revokeRolesFromUser": "username",\n  "roles": [\n    { "role": "readWrite", "db": "yourdb" }\n  ]\n}', admin: false },
    ],
  },
  {
    label: "Collection",
    commands: [
      { name: "collStats",        description: "Collection storage statistics",    template: '{\n  "collStats": "collectionName"\n}',                                admin: false },
      { name: "count",            description: "Count matching documents",         template: '{\n  "count": "collectionName",\n  "query": {}\n}',                    admin: false },
      { name: "validate",         description: "Validate collection integrity",    template: '{\n  "validate": "collectionName"\n}',                                 admin: false },
      { name: "compact",          description: "Compact/defragment a collection",  template: '{\n  "compact": "collectionName"\n}',                                  admin: false },
      { name: "reIndex",          description: "Rebuild all indexes",              template: '{\n  "reIndex": "collectionName"\n}',                                  admin: false },
      { name: "convertToCapped",  description: "Convert to a capped collection",  template: '{\n  "convertToCapped": "collectionName",\n  "size": 1048576\n}',      admin: false },
      { name: "explain",          description: "Explain plan for a find query",   template: '{\n  "explain": {\n    "find": "collectionName",\n    "filter": {}\n  },\n  "verbosity": "executionStats"\n}', admin: false },
      { name: "explainAggregate", description: "Explain plan for an aggregation", template: '{\n  "explain": {\n    "aggregate": "collectionName",\n    "pipeline": [],\n    "cursor": {}\n  },\n  "verbosity": "executionStats"\n}', admin: false },
    ],
  },
  {
    label: "Replication",
    commands: [
      { name: "replSetGetStatus", description: "Replica set status",              template: '{\n  "replSetGetStatus": 1\n}',                                        admin: true  },
      { name: "replSetGetConfig", description: "Replica set configuration",       template: '{\n  "replSetGetConfig": 1\n}',                                        admin: true  },
      { name: "isMaster",         description: "Server role check (legacy)",      template: '{\n  "isMaster": 1\n}',                                                admin: true  },
    ],
  },
  {
    label: "Administration",
    commands: [
      { name: "renameCollection", description: "Rename a collection",             template: '{\n  "renameCollection": "sourcedb.sourcecol",\n  "to": "targetdb.targetcol"\n}', admin: true },
      { name: "dropDatabase",     description: "Drop a database",                 template: '{\n  "dropDatabase": 1\n}',                                            admin: false },
      { name: "fsync",            description: "Flush and optionally lock",       template: '{\n  "fsync": 1\n}',                                                   admin: true  },
      { name: "rotateCertificates", description: "Rotate TLS certificates",       template: '{\n  "rotateCertificates": 1\n}',                                      admin: true  },
      { name: "listIndexes",      description: "List indexes on a collection",    template: '{\n  "listIndexes": "collectionName"\n}',                              admin: false },
      { name: "profile",          description: "Get/set database profiler level", template: '{\n  "profile": -1\n}',                                                admin: false },
    ],
  },
];

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  db: string;
  collection: string; // used to pre-fill collection name in templates
}

export default function CommandsView({ db, collection }: Props) {
  const [commandText, setCommandText] = useState('{\n  "ping": 1\n}');
  const [adminFlag, setAdminFlag]     = useState(false);
  const [running, setRunning]         = useState(false);
  const [result, setResult]           = useState<string | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const [search, setSearch]           = useState("");
  const [duration, setDuration]       = useState<number | null>(null);
  const [cmdHeight, setCmdHeight]     = useState(180);
  const cmdResizing = useRef(false);
  const { t } = useTranslation();

  const applyTemplate = useCallback((cmd: PaletteCommand) => {
    // Replace placeholder collection names with the current one when known
    const text = collection
      ? cmd.template.replace(/collectionName/g, collection)
      : cmd.template;
    setCommandText(text);
    setAdminFlag(cmd.admin);
    setResult(null);
    setError(null);
  }, [collection]);

  const executeCommand = useCallback(async () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(commandText) as Record<string, unknown>;
    } catch {
      setError(t("commands.error.invalidJson"));
      return;
    }
    setRunning(true);
    setResult(null);
    setError(null);
    setDuration(null);
    const t0 = Date.now();
    try {
      const res = await runDbCommand(db, parsed, adminFlag);
      setResult(JSON.stringify(res, null, 2));
      setDuration(Date.now() - t0);
    } catch (e: unknown) {
      const axiosErr = e as { response?: { data?: { error?: string } }; message?: string };
      const msg = axiosErr.response?.data?.error ?? (e instanceof Error ? e.message : String(e));
      setError(msg);
      setDuration(null);
    } finally {
      setRunning(false);
    }
  }, [commandText, db, adminFlag]);

  const filteredPalette = PALETTE.map((cat) => ({
    ...cat,
    commands: search
      ? cat.commands.filter(
          (c) =>
            c.name.toLowerCase().includes(search.toLowerCase()) ||
            c.description.toLowerCase().includes(search.toLowerCase())
        )
      : cat.commands,
  })).filter((cat) => cat.commands.length > 0);

  const commandValid = (() => {
    try { JSON.parse(commandText); return true; } catch { return false; }
  })();

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

  const startCmdResize = (e: React.MouseEvent) => {
    e.preventDefault();
    cmdResizing.current = true;
    const startY = e.clientY;
    const startH = cmdHeight;
    const onMouseMove = (ev: MouseEvent) => {
      if (!cmdResizing.current) return;
      setCmdHeight(Math.min(600, Math.max(80, startH + ev.clientY - startY)));
    };
    const onMouseUp = () => {
      cmdResizing.current = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>

      {/* ── Left: palette ──────────────────────────────────────── */}
      <div style={{
        width: "240px",
        minWidth: "200px",
        borderRight: "1px solid #e2e8f0",
        display: "flex",
        flexDirection: "column",
        background: "#f8fafc",
        overflowY: "auto",
      }}>
        <div style={{ padding: "10px 12px 6px" }}>
          <label htmlFor="cmd-search" className="sr-only">{t("commands.search.label")}</label>
          <input
            id="cmd-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("commands.search.placeholder")}
            style={{
              width: "100%", boxSizing: "border-box",
              padding: "6px 10px", borderRadius: "6px",
              border: "1px solid #e2e8f0", fontSize: "12px",
              fontFamily: FONT, background: "#fff", color: "#1e293b",
              outline: "none",
            }}
          />
        </div>

        {filteredPalette.map((cat) => (
          <div key={cat.label}>
            <h3 style={{
              padding: "8px 12px 4px",
              fontSize: "10px", fontWeight: 700,
              color: "#94a3b8", textTransform: "uppercase",
              letterSpacing: "0.06em", fontFamily: FONT,
              margin: 0,
            }}>
              {t(`commands.category.${cat.label.toLowerCase()}`)}
            </h3>
            {cat.commands.map((cmd) => (
              <button
                key={cmd.name}
                onClick={() => applyTemplate(cmd)}
                title={t(`commands.description.${cmd.name}`)}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "7px 12px", border: "none",
                  background: commandText.includes(`"${cmd.name}"`) ? "#e0f2fe" : "transparent",
                  cursor: "pointer", fontFamily: FONT,
                }}
              >
                <div style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b" }}>{cmd.name}</div>
                <div style={{ fontSize: "11px", color: "#64748b", marginTop: "1px" }}>{t(`commands.description.${cmd.name}`)}</div>
                {cmd.admin && (
                  <span style={{ fontSize: "10px", background: "#fef9c3", color: "#854d0e", borderRadius: "4px", padding: "0 5px", fontWeight: 600 }}>
                    admin
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* ── Right: editor + result ─────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Context bar */}
        <div style={{
          padding: "10px 16px",
          borderBottom: "1px solid #e2e8f0",
          display: "flex", alignItems: "center", gap: "12px",
          background: "#fff", flexWrap: "wrap",
        }}>
          <div style={{ fontSize: "12px", color: "#475569", fontFamily: FONT }}>
            {t("commands.context.runningOn")} <strong style={{ color: "#0f172a" }}>{adminFlag ? "admin" : db}</strong>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", userSelect: "none" }}>
            <input
              type="checkbox"
              checked={adminFlag}
              onChange={(e) => setAdminFlag(e.target.checked)}
              style={{ accentColor: "#2563eb" }}
              aria-label={t("commands.checkbox.useAdminDb")}
            />
            {t("commands.checkbox.useAdminDb")}
          </label>

          <button
            onClick={() => void executeCommand()}
            disabled={running || !commandValid}
            aria-busy={running}
            style={{
              marginLeft: "auto",
              padding: "7px 16px", borderRadius: "6px",
              border: "none", cursor: running || !commandValid ? "not-allowed" : "pointer",
              background: running || !commandValid ? "#94a3b8" : "#2563eb",
              color: "#fff", fontSize: "13px", fontWeight: 600,
              fontFamily: FONT, display: "flex", alignItems: "center", gap: "6px",
            }}
          >
            {running ? t("commands.button.running") : t("commands.button.run")}
          </button>
        </div>

        {/* Editor */}
        <div style={{ flex: "0 0 auto", borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ padding: "6px 16px 4px" }}>
            <span style={{ fontSize: "11px", fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", fontFamily: FONT }}>
              {t("commands.label.command")}
            </span>
          </div>
          <div style={{
            margin: "0 16px 8px",
            border: commandValid ? "1px solid #e2e8f0" : "1px solid #fca5a5",
            borderRadius: "6px", overflow: "hidden",
          }}>
            <Editor
              height={`${cmdHeight}px`}
              defaultLanguage="json"
              path="dbv://command"
              value={commandText}
              onChange={(v) => setCommandText(v ?? "{}")}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                scrollBeyondLastLine: false,
                padding: { top: 8, bottom: 8 },
                wordWrap: "on",
                quickSuggestions: { other: true, comments: false, strings: true },
              }}
              onMount={(editor, monaco) => {
                editor.addCommand(
                  monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
                  () => void executeCommand()
                );
              }}
            />
            <div title={t("query.resize.title")} style={resizeHandleStyle} onMouseDown={startCmdResize} />
          </div>
        </div>

        {/* Result */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: "0 16px 12px" }}>
          <div style={{ padding: "6px 0 4px", display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "11px", fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", fontFamily: FONT }}>
              {t("commands.label.result")}
            </span>
            {error && (
              <span role="status" aria-live="polite" style={{ fontSize: "11px", background: "#fee2e2", color: "#dc2626", borderRadius: "4px", padding: "1px 8px", fontWeight: 600 }}>
                {t("badge.error")}
              </span>
            )}
            {result && !error && (
              <span role="status" aria-live="polite" style={{ fontSize: "11px", background: "#dcfce7", color: "#166534", borderRadius: "4px", padding: "1px 8px", fontWeight: 600 }}>
                {t("badge.success")}
              </span>
            )}
            {duration !== null && !error && (
              <span style={{ fontSize: "11px", color: "#64748b", fontFamily: FONT, marginLeft: "auto" }}>
                {t("query.duration", { duration: duration < 1000 ? `${duration} ms` : `${(duration / 1000).toFixed(2)} s` })}
              </span>
            )}
          </div>
          {error ? (
            <div
              role="alert"
              style={{
                flex: 1, background: "#fef2f2", border: "1px solid #fca5a5",
                borderRadius: "6px", padding: "12px", color: "#dc2626",
                fontSize: "13px", fontFamily: "monospace", overflowY: "auto",
                whiteSpace: "pre-wrap", wordBreak: "break-all",
              }}
            >
              {error}
            </div>
          ) : (
            <div style={{ flex: 1, border: "1px solid #e2e8f0", borderRadius: "6px", overflow: "hidden" }}>
              <Editor
                height="100%"
                defaultLanguage="json"
                value={result ?? t("aggregate.placeholder.result")}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize: 13,
                  scrollBeyondLastLine: false,
                  padding: { top: 8, bottom: 8 },
                  wordWrap: "on",
                  lineNumbers: "off",
                  folding: true,
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
