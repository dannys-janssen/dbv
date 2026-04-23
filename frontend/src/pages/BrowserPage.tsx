import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  getDatabases,
  getCollections,
  createDatabase,
  dropDatabase,
  createCollection,
  dropCollection,
  getDatabaseStats,
  getConnection,
  setConnection,
  reconnectMongo,
  type ConnectionInfo,
} from "../api/mongo";
import { useAuth } from "../context/useAuth";
import CollectionView from "../components/CollectionView";
import { LanguageSelector } from "../components/LanguageSelector";

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
}

function handleFocusTrap(e: React.KeyboardEvent<HTMLDivElement>, container: HTMLElement) {
  if (e.key !== "Tab") return;
  const focusable = getFocusable(container);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === first) { e.preventDefault(); last.focus(); }
  } else {
    if (document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
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

interface Tab {
  id: string;
  db: string;
  col: string;
}

export default function BrowserPage() {
  const { logout, canWrite } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  // ── Sidebar resize ──
  const [sidebarWidth, setSidebarWidth] = useState(420);
  const isResizing = useRef(false);

  // ── Modal focus management ──
  const newDbModalRef = useRef<HTMLDivElement>(null);
  const newColModalRef = useRef<HTMLDivElement>(null);
  const dbStatsModalRef = useRef<HTMLDivElement>(null);
  const changeConnModalRef = useRef<HTMLDivElement>(null);
  const newDbOpenerRef = useRef<HTMLElement | null>(null);
  const newColOpenerRef = useRef<HTMLElement | null>(null);
  const dbStatsOpenerRef = useRef<HTMLElement | null>(null);
  const changeConnOpenerRef = useRef<HTMLElement | null>(null);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      setSidebarWidth(Math.min(700, Math.max(200, ev.clientX)));
    };
    const onMouseUp = () => {
      isResizing.current = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, []);

  // ── Tab state ──
  const [tabs, setTabs] = useState<Tab[]>([{ id: "tab-0", db: "", col: "" }]);
  const [activeTabId, setActiveTabId] = useState("tab-0");

  // ── Sidebar state ──
  const [databases, setDatabases] = useState<string[]>([]);
  const [collections, setCollections] = useState<string[]>([]);
  const [selectedDb, setSelectedDb] = useState("");
  const [dbSearch, setDbSearch] = useState("");
  const [colSearch, setColSearch] = useState("");
  const [hoveredDb, setHoveredDb] = useState<string | null>(null);
  const [hoveredCol, setHoveredCol] = useState<string | null>(null);

  // ── DB/collection management ──
  const [newDbName, setNewDbName] = useState("");
  const [newDbCollection, setNewDbCollection] = useState("");
  const [newDbOpen, setNewDbOpen] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [newColOpen, setNewColOpen] = useState(false);
  const [dbStatsOpen, setDbStatsOpen] = useState(false);
  const [dbStats, setDbStats] = useState<Record<string, unknown> | null>(null);
  const [dbStatsLoading, setDbStatsLoading] = useState(false);

  // ── Connection management ──
  const [connInfo, setConnInfo] = useState<ConnectionInfo | null>(null);
  const [connLoading, setConnLoading] = useState(false);
  const [changeConnOpen, setChangeConnOpen] = useState(false);
  const [newUri, setNewUri] = useState("");
  const [newDefaultDb, setNewDefaultDb] = useState("");
  const [newTlsCaFile, setNewTlsCaFile] = useState("");
  const [newTlsCertKeyFile, setNewTlsCertKeyFile] = useState("");
  const [newTlsAllowInvalid, setNewTlsAllowInvalid] = useState(false);
  const [connError, setConnError] = useState("");

  // ── Tab management ──
  const openCollection = useCallback((db: string, col: string) => {
    const id = `tab-${Date.now()}`;
    setTabs((prev) => [...prev, { id, db, col }]);
    setActiveTabId(id);
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0) {
        const fresh = { id: `tab-${Date.now()}`, db: "", col: "" };
        setActiveTabId(fresh.id);
        return [fresh];
      }
      if (activeTabId === id) {
        const idx = prev.findIndex((t) => t.id === id);
        setActiveTabId(next[Math.max(0, idx - 1)].id);
      }
      return next;
    });
  }, [activeTabId]);

  const reloadDatabases = useCallback(() => {
    getDatabases()
      .then((d) => setDatabases(d.databases))
      .catch((err) => {
        const status = (err as { response?: { status?: number } }).response?.status;
        if (status === 401) {
          logout();
          navigate("/login");
        }
        // otherwise leave databases empty (connection error shown in banner)
      });
  }, [logout, navigate]);

  const reloadCollections = useCallback(() => {
    if (!selectedDb) return;
    getCollections(selectedDb)
      .then((c) => setCollections(c.collections))
      .catch(() => {});
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
    if (!confirm(t("modals.confirmDrop.database", { db: selectedDb }))) return;
    const dbToRemove = selectedDb;
    try {
      await dropDatabase(dbToRemove);
      const nextTabs = tabs.filter((t) => t.db !== dbToRemove);
      const finalTabs = nextTabs.length === 0
        ? [{ id: `tab-${Date.now()}`, db: "", col: "" }]
        : nextTabs;
      setTabs(finalTabs);
      if (!finalTabs.some((t) => t.id === activeTabId)) {
        setActiveTabId(finalTabs[0].id);
      }
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
    if (!confirm(t("modals.confirmDrop.collection", { col }))) return;
    const dbToUpdate = selectedDb;
    try {
      await dropCollection(dbToUpdate, col);
      const nextTabs = tabs.filter((t) => !(t.col === col && t.db === dbToUpdate));
      const finalTabs = nextTabs.length === 0
        ? [{ id: `tab-${Date.now()}`, db: "", col: "" }]
        : nextTabs;
      setTabs(finalTabs);
      if (!finalTabs.some((t) => t.id === activeTabId)) {
        setActiveTabId(finalTabs[0].id);
      }
      reloadCollections();
    } catch (e: unknown) {
      alert("Error: " + (e as Error).message);
    }
  };

  useEffect(() => {
    reloadDatabases();
    getConnection().then(setConnInfo).catch(() => {});
  }, [reloadDatabases]);

  useEffect(() => {
    if (!selectedDb) {
      setCollections([]);
      return;
    }
    getCollections(selectedDb)
      .then((c) => setCollections(c.collections))
      .catch(() => {});
  }, [selectedDb]);

  // Keyboard shortcuts for BrowserPage-level modals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (newDbOpen)      { setNewDbOpen(false);      return; }
        if (newColOpen)     { setNewColOpen(false);      return; }
        if (dbStatsOpen)    { setDbStatsOpen(false);     return; }
        if (changeConnOpen) { setChangeConnOpen(false);  return; }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [newDbOpen, newColOpen, dbStatsOpen, changeConnOpen]);

  // Modal focus management
  useEffect(() => {
    if (newDbOpen) {
      setTimeout(() => getFocusable(newDbModalRef.current!)[0]?.focus(), 0);
    } else {
      newDbOpenerRef.current?.focus();
    }
  }, [newDbOpen]);

  useEffect(() => {
    if (newColOpen) {
      setTimeout(() => getFocusable(newColModalRef.current!)[0]?.focus(), 0);
    } else {
      newColOpenerRef.current?.focus();
    }
  }, [newColOpen]);

  useEffect(() => {
    if (dbStatsOpen) {
      setTimeout(() => getFocusable(dbStatsModalRef.current!)[0]?.focus(), 0);
    } else {
      dbStatsOpenerRef.current?.focus();
    }
  }, [dbStatsOpen]);

  useEffect(() => {
    if (changeConnOpen) {
      setTimeout(() => getFocusable(changeConnModalRef.current!)[0]?.focus(), 0);
    } else {
      changeConnOpenerRef.current?.focus();
    }
  }, [changeConnOpen]);

  const handleReconnect = async () => {
    setConnLoading(true);
    try {
      const info = await reconnectMongo();
      setConnInfo(info);
      if (info.status === "ok") reloadDatabases();
    } catch {
      const info = await getConnection().catch(() => null);
      if (info) setConnInfo(info);
    } finally {
      setConnLoading(false);
    }
  };

  const handleSetConnection = async () => {
    setConnError("");
    setConnLoading(true);
    try {
      const info = await setConnection({
        uri: newUri,
        default_db: newDefaultDb || undefined,
        tls_ca_file: newTlsCaFile || undefined,
        tls_cert_key_file: newTlsCertKeyFile || undefined,
        tls_allow_invalid_certs: newTlsAllowInvalid || undefined,
      });
      setConnInfo(info);
      setChangeConnOpen(false);
      reloadDatabases();
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } }).response?.data?.error ??
        (e as Error).message ??
        "Connection failed";
      setConnError(msg);
    } finally {
      setConnLoading(false);
    }
  };

  const filteredDatabases = databases.filter((db) =>
    db.toLowerCase().includes(dbSearch.toLowerCase())
  );

  const filteredCollections = collections.filter((col) =>
    col.toLowerCase().includes(colSearch.toLowerCase())
  );

  const activeTab = tabs.find((t) => t.id === activeTabId);

  const getTabLabel = (tab: Tab): string => {
    if (!tab.col) return "New Tab";
    const siblings = tabs.filter((t) => t.col === tab.col && t.db === tab.db);
    const hasCrossDbDup = tabs.some((t) => t.col === tab.col && t.db !== tab.db);
    const base = hasCrossDbDup ? `${tab.db}/${tab.col}` : tab.col;
    const label =
      siblings.length > 1
        ? `${base} (${siblings.findIndex((t) => t.id === tab.id) + 1})`
        : base;
    return label.length > 22 ? label.slice(0, 22) + "…" : label;
  };

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        fontFamily: FONT,
        overflow: "hidden",
      }}
    >
      <a href="#main-content" className="skip-link">{t("a11y.skipToContent")}</a>
      {/* ── Sidebar ── */}
      <aside
        style={{
          width: `${sidebarWidth}px`,
          minWidth: `${sidebarWidth}px`,
          background: "#1a2236",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
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
            {t("brand.name")}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <LanguageSelector />
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
              {t("nav.signOut")}
            </button>
          </div>
        </div>

        {/* Connection status indicator */}
        <div
          style={{
            padding: "8px 16px",
            borderBottom: "1px solid #243044",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                flexShrink: 0,
                background:
                  connInfo === null
                    ? "#64748b"
                    : connInfo.status === "ok"
                    ? "#22c55e"
                    : "#ef4444",
              }}
            />
            <span
              title={connInfo?.uri ?? ""}
              style={{
                flex: 1,
                fontSize: "11px",
                color: "#94a3b8",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontFamily: FONT,
              }}
            >
              {connInfo?.uri
                ? connInfo.uri.length > 32
                  ? connInfo.uri.slice(0, 32) + "…"
                  : connInfo.uri
                : t("connection.status.noInfo")}
            </span>
          </div>
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              onClick={() => void handleReconnect()}
              disabled={connLoading}
              style={{
                background: "none",
                border: "1px solid #2d3f5e",
                color: "#94a3b8",
                padding: "3px 8px",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "11px",
                fontFamily: FONT,
              }}
              title={t("connection.button.reconnect.title")}
            >
              {t("connection.button.reconnect.label")}
            </button>
            <button
              onClick={(e) => {
                changeConnOpenerRef.current = e.currentTarget as HTMLElement;
                setNewUri(connInfo?.uri ?? "");
                setNewDefaultDb(connInfo?.default_db ?? "");
                setNewTlsCaFile(connInfo?.tls_ca_file ?? "");
                setNewTlsCertKeyFile(connInfo?.tls_cert_key_file ?? "");
                setNewTlsAllowInvalid(connInfo?.tls_allow_invalid_certs ?? false);
                setConnError("");
                setChangeConnOpen(true);
              }}
              style={{
                background: "none",
                border: "1px solid #2d3f5e",
                color: "#94a3b8",
                padding: "3px 8px",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "11px",
                fontFamily: FONT,
              }}
              title={t("connection.button.change.title")}
            >
              {t("connection.button.change.label")}
            </button>
          </div>
        </div>

        {/* Database + Collection sections – side by side */}
        <div style={{ flex: 1, display: "flex", flexDirection: "row", overflow: "hidden", borderTop: "1px solid #243044" }}>

          {/* Database column */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", borderRight: "1px solid #243044", minWidth: 0 }}>
            <div
              style={{
                padding: "8px 12px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexShrink: 0,
              }}
            >
              <span style={sectionLabelStyle}>{t("nav.section.databases")}</span>
              {canWrite && (
                <button
                  onClick={(e) => { newDbOpenerRef.current = e.currentTarget as HTMLElement; setNewDbOpen(true); }}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#60a5fa",
                    fontSize: "16px",
                    lineHeight: 1,
                    padding: "0 2px",
                  }}
                  title={t("database.button.create.title")}
                  aria-label={t("database.button.create.title")}
                >
                  ＋
                </button>
              )}
            </div>
            <div style={{ padding: "0 12px 8px", flexShrink: 0 }}>
              <input
                value={dbSearch}
                onChange={(e) => setDbSearch(e.target.value)}
                placeholder={t("database.search.placeholder")}
                style={sidebarSearchStyle}
              />
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 12px" }}>
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
                  {t("database.list.empty")}
                </p>
              ) : (
                filteredDatabases.map((db) => {
                  const isSelected = db === selectedDb;
                  const isHovered = hoveredDb === db;
                  return (
                    <div
                      key={db}
                      onClick={() => setSelectedDb(db)}
                      onMouseEnter={() => setHoveredDb(db)}
                      onMouseLeave={() => setHoveredDb(null)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedDb(db); } }}
                      aria-label={t("a11y.openCollection", { name: db })}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
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
                      <span style={{ fontSize: "12px", flexShrink: 0 }}>🗄</span>
                      <span
                        style={{
                          flex: 1,
                          fontSize: "13px",
                          color: isSelected ? "#ffffff" : "#cbd5e1",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontFamily: FONT,
                          textAlign: "left",
                        }}
                      >
                        {db}
                      </span>
                      {isSelected && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            dbStatsOpenerRef.current = e.currentTarget as HTMLElement;
                            setDbStats(null);
                            setDbStatsOpen(true);
                            setDbStatsLoading(true);
                            getDatabaseStats(db)
                              .then(setDbStats)
                              .catch(() => setDbStats(null))
                              .finally(() => setDbStatsLoading(false));
                          }}
                          style={{
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            color: "#94a3b8",
                            fontSize: "14px",
                            padding: "0 2px",
                            lineHeight: 1,
                            flexShrink: 0,
                          }}
                          title={t("database.button.stats.title", { db })}
                          aria-label={t("a11y.collectionStats", { name: db })}
                        >
                          ℹ
                        </button>
                      )}
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
                            flexShrink: 0,
                          }}
                          title={t("database.button.drop.title", { db })}
                          aria-label={t("a11y.dropDatabase", { name: db })}
                        >
                          🗑
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Collection column */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
            <div
              style={{
                padding: "8px 12px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexShrink: 0,
              }}
            >
              <span style={sectionLabelStyle}>{t("nav.section.collections")}</span>
              {canWrite && selectedDb && (
                <button
                  onClick={(e) => { newColOpenerRef.current = e.currentTarget as HTMLElement; setNewColOpen(true); }}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#60a5fa",
                    fontSize: "16px",
                    lineHeight: 1,
                    padding: "0 2px",
                  }}
                  title={t("collection.button.create.title")}
                  aria-label={t("collection.button.create.title")}
                >
                  ＋
                </button>
              )}
            </div>
            <div style={{ padding: "0 12px 8px", flexShrink: 0 }}>
              <input
                value={colSearch}
                onChange={(e) => setColSearch(e.target.value)}
                placeholder={t("collection.search.placeholder")}
                style={sidebarSearchStyle}
                disabled={!selectedDb}
              />
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 12px" }}>
              {!selectedDb ? (
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
                  {t("empty.subtitle.databaseNeeded")}
                </p>
              ) : filteredCollections.length === 0 ? (
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
                  {t("collection.list.empty.noCollections")}{canWrite ? ` ${t("collection.list.empty.canCreate")}` : ""}
                </p>
              ) : (
                filteredCollections.map((col) => {
                  const isSelected = col === activeTab?.col && selectedDb === activeTab?.db;
                  const isHovered = hoveredCol === col;
                  return (
                    <div
                      key={col}
                      onClick={() => openCollection(selectedDb, col)}
                      onMouseEnter={() => setHoveredCol(col)}
                      onMouseLeave={() => setHoveredCol(null)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCollection(selectedDb, col); } }}
                      aria-label={t("a11y.openCollection", { name: col })}
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
                          textAlign: "left",
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
                            flexShrink: 0,
                          }}
                          title={t("collection.button.drop.title", { col })}
                          aria-label={t("a11y.dropCollection", { name: col })}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>
      </aside>

      {/* ── Resize handle ── */}
      <div
        onMouseDown={startResize}
        style={{
          width: "4px",
          flexShrink: 0,
          cursor: "col-resize",
          background: "transparent",
          transition: "background 0.15s",
          zIndex: 10,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "#3b82f6"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
        title={t("ui.sidebar.resize.title")}
      />

      {/* ── Main area ── */}
      <main
        id="main-content"
        style={{
          flex: 1,
          background: "#f8fafc",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* ── Connection error banner ── */}
        {connInfo?.status === "error" && (
          <div
            role="alert"
            aria-live="assertive"
            style={{
              background: "#fef2f2",
              borderBottom: "1px solid #fecaca",
              padding: "8px 16px",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: "13px", color: "#dc2626", flex: 1, fontFamily: FONT }}>
              {t("connection.error.failed")} {connInfo.error ?? "unknown error"}
            </span>
            <button
              onClick={() => void handleReconnect()}
              disabled={connLoading}
              style={{
                background: "#dc2626",
                color: "#fff",
                border: "none",
                padding: "4px 12px",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "12px",
                fontFamily: FONT,
              }}
            >
              Reconnect
            </button>
          </div>
        )}
        {/* ── Tab bar ── */}
        <div
          role="tablist"
          aria-label={t("a11y.tabList")}
          style={{
            background: "#f1f5f9",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "stretch",
            overflowX: "auto",
            flexShrink: 0,
          }}
        >
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const label = getTabLabel(tab);
            const showClose = !!(tab.col) || tabs.length > 1;
            return (
              <div
                key={tab.id}
                role="tab"
                id={`tab-${tab.id}`}
                aria-selected={isActive}
                aria-controls={`panel-${tab.id}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => setActiveTabId(tab.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 12px",
                  cursor: "pointer",
                  background: isActive ? "#ffffff" : "transparent",
                  borderBottom: isActive ? "2px solid #2563eb" : "2px solid transparent",
                  color: isActive ? "#0f172a" : "#64748b",
                  fontSize: "13px",
                  fontFamily: FONT,
                  whiteSpace: "nowrap",
                  userSelect: "none",
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = "#e2e8f0";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = "transparent";
                }}
              >
                <span>{label}</span>
                {showClose && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      fontSize: "16px",
                      color: "#94a3b8",
                      lineHeight: 1,
                      padding: "0 2px",
                      cursor: "pointer",
                    }}
                    aria-label={t("a11y.closeTab", { name: label })}
                    title={t("tabs.button.close.title")}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
          {/* + New tab button */}
          <button
            onClick={() => {
              const id = `tab-${Date.now()}`;
              setTabs((prev) => [...prev, { id, db: "", col: "" }]);
              setActiveTabId(id);
            }}
            style={{
              background: "none",
              border: "none",
              display: "flex",
              alignItems: "center",
              padding: "8px 12px",
              cursor: "pointer",
              color: "#64748b",
              fontSize: "18px",
              lineHeight: 1,
              userSelect: "none",
              flexShrink: 0,
            }}
            aria-label={t("a11y.newTab")}
            title={t("tabs.button.new.title")}
          >
            +
          </button>
        </div>

        {/* ── Content area (all tabs rendered, shown/hidden via tabpanel) ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {tabs.map((tab) => (
            <div
              key={tab.id}
              role="tabpanel"
              id={`panel-${tab.id}`}
              aria-labelledby={`tab-${tab.id}`}
              tabIndex={0}
              style={{ flex: 1, display: tab.id === activeTabId ? "flex" : "none", flexDirection: "column", overflow: "hidden" }}
            >
              <CollectionView
                db={tab.db}
                col={tab.col}
                visible={tab.id === activeTabId}
              />
            </div>
          ))}
        </div>
      </main>

      {/* ── Create Database modal ── */}
      {newDbOpen && (
        <div role="presentation" style={overlayStyle} onClick={() => setNewDbOpen(false)}>
          <div
            ref={newDbModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-createdb-title"
            style={modalBaseStyle}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => newDbModalRef.current && handleFocusTrap(e, newDbModalRef.current)}
          >
            <h3 id="modal-createdb-title" style={modalTitleStyle}>{t("modals.createDatabase.title")}</h3>
            <p style={modalSubtitleStyle}>
              {t("modals.createDatabase.subtitle")}
            </p>
            <label style={modalLabelStyle}>{t("modals.createDatabase.label.dbName")}</label>
            <input
              style={modalInputStyle}
              placeholder={t("modals.createDatabase.placeholder.dbName")}
              value={newDbName}
              onChange={(e) => setNewDbName(e.target.value)}
            />
            <label style={modalLabelStyle}>{t("modals.createDatabase.label.collectionName")}</label>
            <input
              style={modalInputStyle}
              placeholder={t("modals.createDatabase.placeholder.collectionName")}
              value={newDbCollection}
              onChange={(e) => setNewDbCollection(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleCreateDb()}
            />
            <div style={modalFooterStyle}>
              <button
                onClick={() => setNewDbOpen(false)}
                style={cancelBtnStyle}
              >
                {t("buttons.cancel")}
              </button>
              <button
                onClick={() => void handleCreateDb()}
                style={primaryBtnStyle}
              >
                {t("buttons.create")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create Collection modal ── */}
      {newColOpen && (
        <div role="presentation" style={overlayStyle} onClick={() => setNewColOpen(false)}>
          <div
            ref={newColModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-createcol-title"
            style={modalBaseStyle}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => newColModalRef.current && handleFocusTrap(e, newColModalRef.current)}
          >
            <h3 id="modal-createcol-title" style={modalTitleStyle}>{t("modals.createCollection.title")}</h3>
            <p style={modalSubtitleStyle}>
              {t("modals.createCollection.subtitle")} <strong>{selectedDb}</strong>.
            </p>
            <label style={modalLabelStyle}>{t("modals.createCollection.label.name")}</label>
            <input
              style={modalInputStyle}
              placeholder={t("modals.createCollection.placeholder.name")}
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
                {t("buttons.cancel")}
              </button>
              <button
                onClick={() => void handleCreateCollection()}
                style={primaryBtnStyle}
              >
                {t("buttons.create")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Database stats modal ── */}
      {dbStatsOpen && (
        <div role="presentation" style={overlayStyle} onClick={() => setDbStatsOpen(false)}>
          <div
            ref={dbStatsModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-dbstats-title"
            style={{ ...modalBaseStyle, width: "520px" }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => dbStatsModalRef.current && handleFocusTrap(e, dbStatsModalRef.current)}
          >
            <h3 id="modal-dbstats-title" style={modalTitleStyle}>{t("modals.dbStats.title")} {selectedDb}</h3>
            <p style={modalSubtitleStyle}>{t("modals.dbStats.subtitle")}</p>

            {dbStatsLoading ? (
              <p style={{ color: "#64748b", fontSize: "13px", margin: "8px 0 20px" }}>{t("ui.loading")}</p>
            ) : !dbStats ? (
              <p style={{ color: "#94a3b8", fontSize: "13px", margin: "8px 0 20px" }}>{t("modals.dbStats.unavailable")}</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "20px" }}>
                {([
                  { label: t("stats.label.collections"),  value: numVal(dbStats["collections"]).toLocaleString() },
                  { label: t("stats.label.documents"),    value: numVal(dbStats["objects"]).toLocaleString() },
                  { label: t("stats.label.avgDocSize"),   value: formatBytes(numVal(dbStats["avgObjSize"])) },
                  { label: t("stats.label.dataSize"),     value: formatBytes(numVal(dbStats["dataSize"])) },
                  { label: t("stats.label.storageSize"),  value: formatBytes(numVal(dbStats["storageSize"])) },
                  { label: t("stats.label.indexes"),      value: numVal(dbStats["indexes"]).toLocaleString() },
                  { label: t("stats.label.indexSize"),    value: formatBytes(numVal(dbStats["indexSize"])) },
                  { label: t("stats.label.totalSize"),    value: formatBytes(numVal(dbStats["totalSize"])) },
                ] as { label: string; value: string }[]).map((c) => (
                  <div key={c.label} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px 14px" }}>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>{c.label}</div>
                    <div style={{ fontSize: "18px", fontWeight: 700, color: "#1e293b" }}>{c.value}</div>
                  </div>
                ))}
              </div>
            )}

            <div style={modalFooterStyle}>
              <button onClick={() => setDbStatsOpen(false)} style={primaryBtnStyle}>{t("buttons.close")}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Change Connection modal ── */}
      {changeConnOpen && (
        <div role="presentation" style={overlayStyle} onClick={() => { setChangeConnOpen(false); setConnError(""); }}>
          <div
            ref={changeConnModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-changeconn-title"
            style={modalBaseStyle}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => changeConnModalRef.current && handleFocusTrap(e, changeConnModalRef.current)}
          >
            <h3 id="modal-changeconn-title" style={modalTitleStyle}>{t("modals.changeConnection.title")}</h3>
            <p style={modalSubtitleStyle}>
              {t("modals.changeConnection.subtitle")}
            </p>
            <label style={modalLabelStyle}>{t("modals.changeConnection.label.uri")}</label>
            <input
              style={modalInputStyle}
              placeholder={t("modals.changeConnection.placeholder.uri")}
              value={newUri}
              onChange={(e) => setNewUri(e.target.value)}
              autoFocus
            />
            <label style={modalLabelStyle}>{t("modals.changeConnection.label.defaultDb")}</label>
            <input
              style={modalInputStyle}
              placeholder={t("modals.changeConnection.placeholder.defaultDb")}
              value={newDefaultDb}
              onChange={(e) => setNewDefaultDb(e.target.value)}
            />
            <label style={{ ...modalLabelStyle, marginTop: 8 }}>{t("modals.changeConnection.label.tlsCaFile")} <span style={{ fontWeight: 400, color: "#94a3b8" }}>{t("modals.changeConnection.optional")}</span></label>
            <input
              style={modalInputStyle}
              placeholder={t("modals.changeConnection.placeholder.tlsCaFile")}
              value={newTlsCaFile}
              onChange={(e) => setNewTlsCaFile(e.target.value)}
            />
            <label style={modalLabelStyle}>{t("modals.changeConnection.label.tlsCertKeyFile")} <span style={{ fontWeight: 400, color: "#94a3b8" }}>{t("modals.changeConnection.optional")}</span></label>
            <input
              style={modalInputStyle}
              placeholder={t("modals.changeConnection.placeholder.tlsCertKeyFile")}
              value={newTlsCertKeyFile}
              onChange={(e) => setNewTlsCertKeyFile(e.target.value)}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "13px", color: "#374151", margin: "8px 0 12px", fontFamily: FONT }}>
              <input
                type="checkbox"
                checked={newTlsAllowInvalid}
                onChange={(e) => setNewTlsAllowInvalid(e.target.checked)}
                style={{ accentColor: "#ef4444", width: 14, height: 14 }}
              />
              {t("modals.changeConnection.label.allowInvalidTls")}
              <span style={{ color: "#ef4444", fontSize: 11, fontWeight: 600 }}>{t("modals.changeConnection.warning.insecure")}</span>
            </label>
            {connError && (
              <p role="alert" style={{ color: "#dc2626", fontSize: "13px", margin: "-8px 0 12px", fontFamily: FONT }}>
                {connError}
              </p>
            )}
            <div style={modalFooterStyle}>
              <button
                onClick={() => { setChangeConnOpen(false); setConnError(""); }}
                style={cancelBtnStyle}
              >
                {t("buttons.cancel")}
              </button>
              <button
                onClick={() => void handleSetConnection()}
                disabled={connLoading || !newUri.trim()}
                style={{ ...primaryBtnStyle, opacity: connLoading || !newUri.trim() ? 0.6 : 1 }}
              >
                {connLoading ? t("ui.connecting") : t("buttons.connect")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
