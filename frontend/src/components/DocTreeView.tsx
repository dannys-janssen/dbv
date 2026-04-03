import { useState, useCallback } from "react";

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

// ── type colours ────────────────────────────────────────────────────────────
function typeColor(value: unknown): string {
  if (value === null) return "#94a3b8";
  if (typeof value === "boolean") return "#7c3aed";
  if (typeof value === "number") return "#0369a1";
  if (typeof value === "string") return "#15803d";
  if (Array.isArray(value)) return "#b45309";
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("$oid" in obj) return "#6366f1";
    if ("$date" in obj) return "#0891b2";
    if ("$numberInt" in obj || "$numberLong" in obj || "$numberDouble" in obj)
      return "#0369a1";
  }
  return "#374151";
}

function formatPrimitive(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("$oid" in obj) return String(obj["$oid"]);
    if ("$date" in obj) {
      const d = obj["$date"];
      if (typeof d === "string" || typeof d === "number") {
        return new Date(d).toISOString();
      }
    }
    if ("$numberInt" in obj) return String(obj["$numberInt"]);
    if ("$numberLong" in obj) return String(obj["$numberLong"]);
    if ("$numberDouble" in obj) return String(obj["$numberDouble"]);
  }
  return JSON.stringify(value);
}

function isPrimitive(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== "object") return true;
  const obj = value as Record<string, unknown>;
  return (
    "$oid" in obj ||
    "$date" in obj ||
    "$numberInt" in obj ||
    "$numberLong" in obj ||
    "$numberDouble" in obj
  );
}

function typeLabel(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `Array(${(value as unknown[]).length})`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("$oid" in obj) return "ObjectId";
    if ("$date" in obj) return "Date";
    if ("$numberInt" in obj) return "Int32";
    if ("$numberLong" in obj) return "Int64";
    if ("$numberDouble" in obj) return "Double";
    return `Object(${Object.keys(obj).length})`;
  }
  return typeof value;
}

// ── recursive tree node ──────────────────────────────────────────────────────
interface TreeNodeProps {
  nodeKey: string | number;
  value: unknown;
  path: string;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
}

function TreeNode({ nodeKey, value, path, depth, expanded, onToggle }: TreeNodeProps) {
  const indent = depth * 18;
  const isExp = expanded.has(path);

  if (isPrimitive(value)) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "6px",
          padding: "2px 0",
          paddingLeft: indent + 18,
        }}
      >
        <span style={{ color: "#64748b", fontSize: "12px", fontFamily: "monospace", minWidth: 0 }}>
          {String(nodeKey)}:
        </span>
        <span
          style={{
            color: typeColor(value),
            fontSize: "12px",
            fontFamily: "monospace",
            wordBreak: "break-all",
          }}
        >
          {formatPrimitive(value)}
        </span>
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const children = isArray
    ? (value as unknown[]).map((v, i) => ({ k: i, v }))
    : Object.entries(value as Record<string, unknown>).map(([k, v]) => ({ k, v }));

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "4px",
          padding: "2px 0",
          paddingLeft: indent,
          cursor: "pointer",
          userSelect: "none",
        }}
        onClick={() => onToggle(path)}
      >
        <span
          style={{
            width: "16px",
            textAlign: "center",
            fontSize: "10px",
            color: "#94a3b8",
            flexShrink: 0,
          }}
        >
          {isExp ? "▼" : "▶"}
        </span>
        <span style={{ color: "#64748b", fontSize: "12px", fontFamily: "monospace" }}>
          {String(nodeKey)}:
        </span>
        <span
          style={{
            color: typeColor(value),
            fontSize: "11px",
            fontFamily: "monospace",
            opacity: 0.8,
          }}
        >
          {typeLabel(value)}
        </span>
      </div>
      {isExp && (
        <div style={{ borderLeft: "1px dashed #e2e8f0", marginLeft: indent + 8 }}>
          {children.map(({ k, v }) => (
            <TreeNode
              key={String(k)}
              nodeKey={k}
              value={v}
              path={`${path}.${String(k)}`}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── single document card ─────────────────────────────────────────────────────
interface DocCardProps {
  doc: Record<string, unknown>;
  docId: string;
  isSelected: boolean;
  canWrite: boolean;
  onSelect: (checked: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}

function DocCard({ doc, isSelected, canWrite, onSelect, onEdit, onDelete }: DocCardProps) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const onToggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const paths = new Set<string>();
    function collectPaths(value: unknown, path: string) {
      if (isPrimitive(value)) return;
      paths.add(path);
      if (Array.isArray(value)) {
        (value as unknown[]).forEach((v, i) => collectPaths(v, `${path}.${i}`));
      } else {
        Object.entries(value as Record<string, unknown>).forEach(([k, v]) =>
          collectPaths(v, `${path}.${k}`)
        );
      }
    }
    Object.entries(doc).forEach(([k, v]) => collectPaths(v, k));
    setExpanded(paths);
  }, [doc]);

  const collapseAll = useCallback(() => setExpanded(new Set()), []);

  const fields = Object.entries(doc).filter(([k]) => k !== "_id");
  const idValue = doc["_id"];

  return (
    <div
      style={{
        border: `1px solid ${isSelected ? "#93c5fd" : "#e2e8f0"}`,
        borderRadius: "8px",
        marginBottom: "8px",
        background: isSelected ? "#eff6ff" : "#ffffff",
        overflow: "hidden",
        transition: "border-color 0.15s",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "8px 12px",
          background: isSelected ? "#dbeafe" : "#f8fafc",
          borderBottom: open ? "1px solid #e2e8f0" : "none",
          cursor: "pointer",
        }}
        onClick={() => setOpen((o) => !o)}
      >
        {/* checkbox — stop propagation so clicking it doesn't toggle doc open */}
        <div onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => onSelect(e.target.checked)}
            style={{ cursor: "pointer" }}
          />
        </div>

        <span
          style={{
            fontSize: "10px",
            color: "#94a3b8",
            width: "14px",
            textAlign: "center",
            flexShrink: 0,
          }}
        >
          {open ? "▼" : "▶"}
        </span>

        {/* _id */}
        <span
          style={{
            fontFamily: "monospace",
            fontSize: "12px",
            color: "#6366f1",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {formatPrimitive(idValue)}
        </span>

        {/* field count badge */}
        <span
          style={{
            fontSize: "11px",
            color: "#94a3b8",
            background: "#f1f5f9",
            borderRadius: "10px",
            padding: "1px 7px",
            whiteSpace: "nowrap",
          }}
        >
          {fields.length + 1} fields
        </span>

        {/* actions — stop propagation */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ display: "flex", gap: "6px", flexShrink: 0 }}
        >
          <button
            onClick={onEdit}
            style={{
              background: "transparent",
              color: "#374151",
              border: "1px solid #e2e8f0",
              padding: "3px 10px",
              borderRadius: "4px",
              fontSize: "12px",
              cursor: "pointer",
              fontFamily: FONT,
            }}
          >
            Edit
          </button>
          {canWrite && (
            <button
              onClick={onDelete}
              style={{
                background: "#fee2e2",
                color: "#dc2626",
                border: "none",
                padding: "3px 10px",
                borderRadius: "4px",
                fontSize: "12px",
                cursor: "pointer",
                fontFamily: FONT,
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      {open && (
        <div style={{ padding: "6px 12px 10px" }}>
          {/* expand / collapse all toolbar */}
          <div
            style={{
              display: "flex",
              gap: "10px",
              marginBottom: "6px",
              paddingBottom: "6px",
              borderBottom: "1px solid #f1f5f9",
            }}
          >
            <button
              onClick={expandAll}
              style={{ background: "none", border: "none", color: "#6366f1", fontSize: "11px", cursor: "pointer", padding: 0, fontFamily: FONT }}
            >
              Expand all
            </button>
            <button
              onClick={collapseAll}
              style={{ background: "none", border: "none", color: "#6366f1", fontSize: "11px", cursor: "pointer", padding: 0, fontFamily: FONT }}
            >
              Collapse all
            </button>
          </div>

          {/* _id row always first */}
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "6px",
              padding: "2px 0",
              paddingLeft: 18,
            }}
          >
            <span style={{ color: "#64748b", fontSize: "12px", fontFamily: "monospace" }}>_id:</span>
            <span style={{ color: typeColor(idValue), fontSize: "12px", fontFamily: "monospace" }}>
              {formatPrimitive(idValue)}
            </span>
          </div>

          {/* remaining fields */}
          {fields.map(([k, v]) => (
            <TreeNode
              key={k}
              nodeKey={k}
              value={v}
              path={k}
              depth={0}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── public component ─────────────────────────────────────────────────────────
export interface DocTreeViewProps {
  documents: Record<string, unknown>[];
  selectedIds: Set<string>;
  onSelectOne: (id: string, checked: boolean) => void;
  onSelectAll: (checked: boolean) => void;
  canWrite: boolean;
  onEdit: (doc: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
  getDocId: (doc: Record<string, unknown>) => string;
  loading: boolean;
  filterText: string;
}

export default function DocTreeView({
  documents,
  selectedIds,
  onSelectOne,
  onSelectAll,
  canWrite,
  onEdit,
  onDelete,
  getDocId,
  loading,
  filterText,
}: DocTreeViewProps) {
  if (loading) {
    return (
      <p style={{ color: "#64748b", fontSize: "13px", padding: "20px 0", fontFamily: FONT }}>
        Loading…
      </p>
    );
  }

  if (documents.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px" }}>
        <div style={{ fontSize: "32px", marginBottom: "8px" }}>📭</div>
        <p style={{ color: "#374151", margin: "0 0 4px 0", fontWeight: 500, fontFamily: FONT }}>
          No documents found
        </p>
        <p style={{ color: "#94a3b8", fontSize: "12px", margin: 0, fontFamily: FONT }}>
          {filterText ? "Try adjusting your filter." : "This collection is empty."}
        </p>
      </div>
    );
  }

  const allSelected = documents.length > 0 && documents.every((d) => selectedIds.has(getDocId(d)));
  const someSelected = selectedIds.size > 0 && !allSelected;

  return (
    <div>
      {/* select-all bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "6px 2px",
          marginBottom: "6px",
          borderBottom: "1px solid #f1f5f9",
        }}
      >
        <input
          type="checkbox"
          checked={allSelected}
          ref={(el) => { if (el) el.indeterminate = someSelected; }}
          onChange={(e) => onSelectAll(e.target.checked)}
          style={{ cursor: "pointer" }}
        />
        <span style={{ fontSize: "12px", color: "#64748b", fontFamily: FONT }}>
          Select all on page
        </span>
      </div>

      {documents.map((doc) => {
        const id = getDocId(doc);
        return (
          <DocCard
            key={id}
            doc={doc}
            docId={id}
            isSelected={selectedIds.has(id)}
            canWrite={canWrite}
            onSelect={(checked) => onSelectOne(id, checked)}
            onEdit={() => onEdit(doc)}
            onDelete={() => onDelete(id)}
          />
        );
      })}
    </div>
  );
}
