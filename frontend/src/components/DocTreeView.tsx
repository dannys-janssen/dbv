import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatBsonValue, isBsonPrimitive, bsonTypeColor, bsonTypeLabel } from "../utils/bsonFormat";

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

// ── recursive tree node ───────────────────────────────────────────────────────
// Each TreeNode manages its OWN isExpanded state.
// defaultExpanded comes from the parent's "expand all / collapse all" action.
// Changing the `key` on the tree container remounts nodes with the new default.
interface TreeNodeProps {
  nodeKey: string | number;
  value: unknown;
  depth: number;
  defaultExpanded: boolean;
}

function TreeNode({ nodeKey, value, depth, defaultExpanded }: TreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const indent = depth * 18;

  const contentId = `tree-content-${depth}-${String(nodeKey)}`;

  if (isBsonPrimitive(value)) {
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
        <span style={{ color: bsonTypeColor(value), fontSize: "12px", fontFamily: "monospace", wordBreak: "break-all" }}>
          {formatBsonValue(value)}
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
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-controls={contentId}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "4px",
          padding: "2px 0",
          paddingLeft: indent,
          cursor: "pointer",
          userSelect: "none",
        }}
        onClick={() => setIsExpanded((e) => !e)}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            setIsExpanded((ex) => !ex);
          }
        }}
      >
        <span aria-hidden="true" style={{ width: "16px", textAlign: "center", fontSize: "10px", color: "#94a3b8", flexShrink: 0 }}>
          {isExpanded ? "▼" : "▶"}
        </span>
        <span style={{ color: "#64748b", fontSize: "12px", fontFamily: "monospace" }}>
          {String(nodeKey)}:
        </span>
        <span style={{ color: bsonTypeColor(value), fontSize: "11px", fontFamily: "monospace", opacity: 0.8 }}>
          {bsonTypeLabel(value)}
        </span>
      </div>
      {isExpanded && (
        <div id={contentId} style={{ borderLeft: "1px dashed #e2e8f0", marginLeft: indent + 8 }}>
          {children.map(({ k, v }) => (
            <TreeNode
              key={String(k)}
              nodeKey={k}
              value={v}
              depth={depth + 1}
              defaultExpanded={defaultExpanded}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── single document card ──────────────────────────────────────────────────────
interface DocCardProps {
  doc: Record<string, unknown>;
  isSelected: boolean;
  canWrite: boolean;
  onSelect: (checked: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}

function DocCard({ doc, isSelected, canWrite, onSelect, onEdit, onDelete }: DocCardProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // treeKey changes whenever expand-all / collapse-all is clicked, forcing
  // TreeNode remount so they reinitialise with the correct defaultExpanded.
  const [treeState, setTreeState] = useState<{ expanded: boolean; key: number }>({
    expanded: false,
    key: 0,
  });

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
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-controls={`doc-body-${String(idValue)}`}
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
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        <div onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => onSelect(e.target.checked)}
            style={{ cursor: "pointer" }}
          />
        </div>

        <span aria-hidden="true" style={{ fontSize: "10px", color: "#94a3b8", width: "14px", textAlign: "center", flexShrink: 0 }}>
          {open ? "▼" : "▶"}
        </span>

        <span style={{ fontFamily: "monospace", fontSize: "12px", color: "#6366f1", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {formatBsonValue(idValue)}
        </span>

        <span style={{ fontSize: "11px", color: "#94a3b8", background: "#f1f5f9", borderRadius: "10px", padding: "1px 7px", whiteSpace: "nowrap" }}>
          {t("documents.fieldCount", { count: fields.length + 1 })}
        </span>

        <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
          <button
            onClick={onEdit}
            style={{ background: "transparent", color: "#374151", border: "1px solid #e2e8f0", padding: "3px 10px", borderRadius: "4px", fontSize: "12px", cursor: "pointer", fontFamily: FONT }}
          >
            {t("buttons.edit")}
          </button>
          {canWrite && (
            <button
              onClick={onDelete}
              style={{ background: "#fee2e2", color: "#dc2626", border: "none", padding: "3px 10px", borderRadius: "4px", fontSize: "12px", cursor: "pointer", fontFamily: FONT }}
            >
              {t("buttons.delete")}
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      {open && (
        <div id={`doc-body-${String(idValue)}`} style={{ padding: "6px 12px 10px" }}>
          {/* Expand / collapse all bar */}
          <div style={{ display: "flex", gap: "10px", marginBottom: "6px", paddingBottom: "6px", borderBottom: "1px solid #f1f5f9" }}>
            <button
              onClick={(e) => { e.stopPropagation(); setTreeState((s) => ({ expanded: true, key: s.key + 1 })); }}
              style={{ background: "none", border: "none", color: "#6366f1", fontSize: "11px", cursor: "pointer", padding: 0, fontFamily: FONT }}
            >
              {t("tree.button.expandAll")}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setTreeState((s) => ({ expanded: false, key: s.key + 1 })); }}
              style={{ background: "none", border: "none", color: "#6366f1", fontSize: "11px", cursor: "pointer", padding: 0, fontFamily: FONT }}
            >
              {t("tree.button.collapseAll")}
            </button>
          </div>

          {/* _id row (always first, always shown as primitive) */}
          <div style={{ display: "flex", alignItems: "baseline", gap: "6px", padding: "2px 0", paddingLeft: 18 }}>
            <span style={{ color: "#64748b", fontSize: "12px", fontFamily: "monospace" }}>_id:</span>
            <span style={{ color: bsonTypeColor(idValue), fontSize: "12px", fontFamily: "monospace" }}>
              {formatBsonValue(idValue)}
            </span>
          </div>

          {/* Remaining fields — key forces remount when treeState changes */}
          <div key={treeState.key}>
            {fields.map(([k, v]) => (
              <TreeNode
                key={k}
                nodeKey={k}
                value={v}
                depth={0}
                defaultExpanded={treeState.expanded}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── public component ──────────────────────────────────────────────────────────
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
  const { t } = useTranslation();
  if (loading) {
    return (
      <p style={{ color: "#64748b", fontSize: "13px", padding: "20px 0", fontFamily: FONT }}>
        {t("ui.loading")}
      </p>
    );
  }

  if (documents.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px" }}>
        <div style={{ fontSize: "32px", marginBottom: "8px" }}>📭</div>
        <p style={{ color: "#374151", margin: "0 0 4px 0", fontWeight: 500, fontFamily: FONT }}>
          {t("documents.list.empty")}
        </p>
        <p style={{ color: "#94a3b8", fontSize: "12px", margin: 0, fontFamily: FONT }}>
          {filterText ? t("documents.list.emptyWithFilter") : t("documents.list.emptyNoFilter")}
        </p>
      </div>
    );
  }

  const allSelected = documents.length > 0 && documents.every((d) => selectedIds.has(getDocId(d)));
  const someSelected = selectedIds.size > 0 && !allSelected;

  return (
    <div role="tree">
      {/* Select-all bar */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 2px", marginBottom: "6px", borderBottom: "1px solid #f1f5f9" }}>
        <input
          type="checkbox"
          checked={allSelected}
          ref={(el) => { if (el) el.indeterminate = someSelected; }}
          onChange={(e) => onSelectAll(e.target.checked)}
          style={{ cursor: "pointer" }}
        />
        <span style={{ fontSize: "12px", color: "#64748b", fontFamily: FONT }}>
          {t("tree.checkbox.selectAllLabel")}
        </span>
      </div>

      {documents.map((doc) => {
        const id = getDocId(doc);
        return (
          <div role="treeitem" key={id}>
            <DocCard
              doc={doc}
              isSelected={selectedIds.has(id)}
              canWrite={canWrite}
              onSelect={(checked) => onSelectOne(id, checked)}
              onEdit={() => onEdit(doc)}
              onDelete={() => onDelete(id)}
            />
          </div>
        );
      })}
    </div>
  );
}
