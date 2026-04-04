/**
 * DocFormEditor.tsx
 *
 * A form-based document editor built from a CollectionSchema.
 * Each top-level field gets a type-appropriate input widget:
 *   date       → datetime-local input
 *   bool       → checkbox
 *   int/double → number input
 *   string     → text input
 *   objectId   → text input (hex string)
 *   uuid       → text input (base64/UUID display)
 *   object / array / mixed → JSON textarea
 *
 * Extra doc fields not found in the schema are shown as JSON textareas.
 * The component is purely controlled: it receives a JSON string and emits
 * an updated JSON string on every change.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { CollectionSchema } from "../api/mongo";

// ── helpers ───────────────────────────────────────────────────────────────────

/** Extract an ISO string from a BSON $date value (any canonical form). */
function bsonDateToIso(v: unknown): string {
  if (!v || typeof v !== "object") return "";
  const d = v as Record<string, unknown>;
  if (typeof d.$date === "string") return d.$date;
  if (d.$date && typeof d.$date === "object") {
    const inner = d.$date as Record<string, unknown>;
    if (typeof inner.$numberLong === "string") {
      return new Date(Number(inner.$numberLong)).toISOString();
    }
  }
  return "";
}

/**
 * Format an ISO string for display as UTC date + time pair.
 * Returns { date: "YYYY-MM-DD", time: "HH:MM:SS" } in UTC.
 */
function isoToUtcParts(iso: string): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return { date: "", time: "" };
    const full = d.toISOString(); // always UTC, e.g. "2024-03-01T14:30:00.000Z"
    return { date: full.slice(0, 10), time: full.slice(11, 19) };
  } catch {
    return { date: "", time: "" };
  }
}

/** Combine UTC date + time strings back into a BSON $date object. */
function utcPartsToBsonDate(date: string, time: string): Record<string, string> {
  const iso = date && time ? `${date}T${time}.000Z` : date ? `${date}T00:00:00.000Z` : new Date(0).toISOString();
  return { $date: iso };
}

/** Extract a hex string from a BSON $oid value. */
function bsonOidToHex(v: unknown): string {
  if (!v || typeof v !== "object") return "";
  return (v as Record<string, unknown>).$oid as string ?? "";
}

/** Convert a hex string back to a BSON $oid object. */
function hexToBsonOid(hex: string): Record<string, string> {
  return { $oid: hex };
}

/** Try to determine the best BSON type for a given doc value. */
function detectValueType(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "double";
  if (typeof v === "string") return "string";
  if (Array.isArray(v)) return "array";
  if (typeof v === "object") {
    const keys = Object.keys(v as object);
    if (keys.includes("$date")) return "date";
    if (keys.includes("$oid")) return "objectId";
    if (keys.includes("$binary")) return "uuid";
    if (keys.includes("$numberLong")) return "long";
    if (keys.includes("$numberDecimal")) return "decimal";
    return "object";
  }
  return "string";
}

/** Pick the best single BSON type from a schema field's types array. */
function pickDominantType(types: string[]): string {
  const priority = ["date", "objectId", "uuid", "bool", "int", "long", "double", "decimal", "string", "object", "array", "binData"];
  for (const t of priority) {
    if (types.includes(t)) return t;
  }
  return types[0] ?? "string";
}

/** True if this type maps to a simple scalar form control. */
function isSimpleType(t: string): boolean {
  return ["date", "bool", "int", "long", "double", "decimal", "string", "objectId"].includes(t);
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return "{}";
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s; // keep as string if not parseable
  }
}

// ── types ─────────────────────────────────────────────────────────────────────

interface FieldState {
  key: string;
  type: string;       // detected/schema type
  /** For scalar types, the edited string/boolean. For complex, JSON string. */
  displayValue: string;
  isNull: boolean;
  fromSchema: boolean;
}

function docValueToFieldState(key: string, v: unknown, schemaType: string | null): FieldState {
  const isNull = v === null || v === undefined;
  const type = schemaType ?? detectValueType(v);

  let displayValue = "";

  if (!isNull) {
    switch (type) {
      case "date": {
        const parts = isoToUtcParts(bsonDateToIso(v));
        displayValue = parts.date && parts.time ? `${parts.date}|${parts.time}` : "";
        break;
      }
      case "objectId":
        displayValue = bsonOidToHex(v);
        break;
      case "bool":
        displayValue = String(Boolean(v));
        break;
      case "int":
      case "long":
      case "double":
      case "decimal":
        if (typeof v === "number") displayValue = String(v);
        else if (typeof v === "object" && v !== null) {
          const inner = v as Record<string, unknown>;
          displayValue = String(inner.$numberLong ?? inner.$numberDecimal ?? "");
        } else displayValue = String(v);
        break;
      case "string":
        displayValue = typeof v === "string" ? v : safeStringify(v);
        break;
      default:
        displayValue = safeStringify(v);
    }
  }

  return { key, type, displayValue, isNull, fromSchema: schemaType !== null };
}

function fieldStateToBsonValue(f: FieldState): unknown {
  if (f.isNull) return null;

  switch (f.type) {
    case "date": {
      const [datePart, timePart] = f.displayValue.split("|");
      return f.displayValue ? utcPartsToBsonDate(datePart ?? "", timePart ?? "") : null;
    }
    case "objectId":
      return f.displayValue ? hexToBsonOid(f.displayValue) : null;
    case "bool":
      return f.displayValue === "true";
    case "int":
      return f.displayValue !== "" ? parseInt(f.displayValue, 10) : null;
    case "double":
      return f.displayValue !== "" ? parseFloat(f.displayValue) : null;
    case "long":
      return f.displayValue !== "" ? { $numberLong: f.displayValue } : null;
    case "decimal":
      return f.displayValue !== "" ? { $numberDecimal: f.displayValue } : null;
    case "string":
      return f.displayValue;
    default:
      return safeParse(f.displayValue);
  }
}

// ── sub-components ────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: "#cbd5e1",
  marginBottom: 4,
  textAlign: "left",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 10px",
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 6,
  color: "#f1f5f9",
  fontSize: 14,
  boxSizing: "border-box",
  outline: "none",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  fontFamily: "monospace",
  resize: "vertical",
  minHeight: 60,
};

const typeTagStyle = (type: string): React.CSSProperties => {
  const colors: Record<string, string> = {
    date: "#0ea5e9",
    objectId: "#a78bfa",
    bool: "#f59e0b",
    int: "#34d399",
    long: "#34d399",
    double: "#34d399",
    decimal: "#34d399",
    string: "#f1f5f9",
    object: "#94a3b8",
    array: "#94a3b8",
    uuid: "#fb923c",
  };
  return {
    fontSize: 10,
    fontWeight: 700,
    color: colors[type] ?? "#94a3b8",
    background: "#0f172a",
    border: `1px solid ${colors[type] ?? "#334155"}`,
    borderRadius: 4,
    padding: "1px 5px",
    marginLeft: 6,
    verticalAlign: "middle",
    letterSpacing: "0.05em",
  };
};

interface FieldRowProps {
  field: FieldState;
  isId: boolean;
  isEditing: boolean;
  onChange: (key: string, update: Partial<FieldState>) => void;
  onRemove: (key: string) => void;
}

const FieldRow: React.FC<FieldRowProps> = ({ field, isId, isEditing, onChange, onRemove }) => {
  const readOnly = isId && isEditing;

  const handleNull = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(field.key, { isNull: e.target.checked });
  };

  const handleValue = (val: string) => {
    onChange(field.key, { displayValue: val, isNull: false });
  };

  const handleType = (newType: string) => {
    onChange(field.key, { type: newType, displayValue: "", isNull: false });
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
        <label style={{ ...labelStyle, marginBottom: 0, flex: 1 }}>
          {field.key}
          <span style={typeTagStyle(field.type)}>{field.type}</span>
        </label>

        {/* Type selector for non-id, non-schema fields */}
        {!field.fromSchema && !isId && (
          <select
            value={field.type}
            onChange={(e) => handleType(e.target.value)}
            style={{
              ...inputStyle,
              width: "auto",
              fontSize: 11,
              padding: "2px 6px",
              marginLeft: 8,
            }}
          >
            {["string", "int", "double", "long", "decimal", "bool", "date", "objectId", "object", "array"].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}

        {/* Null toggle */}
        {!readOnly && (
          <label style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 8, fontSize: 11, color: "#64748b", cursor: "pointer" }}>
            <input type="checkbox" checked={field.isNull} onChange={handleNull} style={{ accentColor: "#64748b" }} />
            null
          </label>
        )}

        {/* Remove button — all fields except _id can be removed */}
        {!isId && (
          <button
            onClick={() => onRemove(field.key)}
            title="Remove field"
            style={{
              marginLeft: 8,
              background: "none",
              border: "none",
              color: "#ef4444",
              cursor: "pointer",
              fontSize: 14,
              padding: "0 4px",
              lineHeight: 1,
            }}
          >×</button>
        )}
      </div>

      {field.isNull || readOnly ? (
        <input
          type="text"
          readOnly
          value={readOnly ? (field.displayValue || field.key) : "null"}
          style={{ ...inputStyle, opacity: 0.5, cursor: "not-allowed" }}
        />
      ) : field.type === "bool" ? (
        <div style={{ display: "flex", gap: 16, padding: "6px 10px", background: "#1e293b", border: "1px solid #334155", borderRadius: 6 }}>
          {["true", "false"].map((opt) => (
            <label key={opt} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "#f1f5f9", fontSize: 14, userSelect: "none" }}>
              <input
                type="radio"
                name={`bool-${field.key}`}
                value={opt}
                checked={field.displayValue === opt}
                onChange={() => handleValue(opt)}
                style={{ accentColor: "#3b82f6", cursor: "pointer" }}
              />
              {opt}
            </label>
          ))}
        </div>
      ) : field.type === "date" ? (
        (() => {
          const [datePart = "", timePart = ""] = field.displayValue.split("|");
          return (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="date"
                value={datePart}
                onChange={(e) => handleValue(`${e.target.value}|${timePart || "00:00:00"}`)}
                style={{ ...inputStyle, flex: 1, colorScheme: "dark" }}
              />
              <input
                type="time"
                value={timePart}
                onChange={(e) => handleValue(`${datePart}|${e.target.value}`)}
                step="1"
                style={{ ...inputStyle, flex: 1, colorScheme: "dark" }}
              />
              <span style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap" }}>UTC</span>
            </div>
          );
        })()
      ) : isSimpleType(field.type) ? (
        <input
          type={["int", "double", "long", "decimal"].includes(field.type) ? "number" : "text"}
          value={field.displayValue}
          onChange={(e) => handleValue(e.target.value)}
          placeholder={field.type === "objectId" ? "24-character hex string" : ""}
          step={field.type === "double" || field.type === "decimal" ? "any" : undefined}
          style={inputStyle}
        />
      ) : (
        <textarea
          value={field.displayValue}
          onChange={(e) => handleValue(e.target.value)}
          placeholder="JSON value"
          style={textareaStyle}
          spellCheck={false}
        />
      )}
    </div>
  );
};

// ── main component ────────────────────────────────────────────────────────────

interface DocFormEditorProps {
  schema: CollectionSchema | null;
  value: string;   // current JSON document string
  onChange: (json: string) => void;
  isEditing: boolean; // true when editing an existing doc, false when creating
}

const DocFormEditor: React.FC<DocFormEditorProps> = ({ schema, value, onChange, isEditing }) => {
  const [fields, setFields] = useState<FieldState[]>([]);
  const [newFieldKey, setNewFieldKey] = useState("");
  const [newFieldType, setNewFieldType] = useState("string");
  const [addError, setAddError] = useState("");

  // Build the initial field state from the incoming JSON + schema
  const initFields = useCallback((jsonStr: string) => {
    let doc: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        doc = parsed as Record<string, unknown>;
      }
    } catch {
      // empty doc
    }

    const schemaTopLevel = new Map<string, string>();
    if (schema) {
      for (const f of schema.fields) {
        if (!f.path.includes(".")) {
          schemaTopLevel.set(f.path, pickDominantType(f.types));
        }
      }
    }

    const result: FieldState[] = [];

    // Schema fields first (preserving schema order)
    for (const [key, schemaType] of schemaTopLevel) {
      const v = Object.prototype.hasOwnProperty.call(doc, key) ? doc[key] : undefined;
      result.push(docValueToFieldState(key, v, schemaType));
    }

    // Extra fields in the doc not covered by schema
    for (const key of Object.keys(doc)) {
      if (!schemaTopLevel.has(key)) {
        result.push(docValueToFieldState(key, doc[key], null));
      }
    }

    setFields(result);
  }, [schema]);

  // Initialise whenever the incoming JSON or schema changes (only on open)
  const prevValue = React.useRef<string>("");
  useEffect(() => {
    if (value !== prevValue.current) {
      prevValue.current = value;
      initFields(value);
    }
  }, [value, initFields]);

  // Serialise the field states back to a JSON string
  const serialise = useCallback((fs: FieldState[]): string => {
    const doc: Record<string, unknown> = {};
    for (const f of fs) {
      doc[f.key] = fieldStateToBsonValue(f);
    }
    return JSON.stringify(doc, null, 2);
  }, []);

  const handleChange = useCallback((key: string, update: Partial<FieldState>) => {
    setFields((prev) => {
      const next = prev.map((f) => (f.key === key ? { ...f, ...update } : f));
      onChange(serialise(next));
      return next;
    });
  }, [onChange, serialise]);

  const handleRemove = useCallback((key: string) => {
    setFields((prev) => {
      const next = prev.filter((f) => f.key !== key);
      onChange(serialise(next));
      return next;
    });
  }, [onChange, serialise]);

  const handleAddField = useCallback(() => {
    const key = newFieldKey.trim();
    if (!key) { setAddError("Field name is required."); return; }
    if (fields.some((f) => f.key === key)) { setAddError(`Field "${key}" already exists.`); return; }
    setAddError("");
    const newField: FieldState = {
      key,
      type: newFieldType,
      displayValue: "",
      isNull: false,
      fromSchema: false,
    };
    setFields((prev) => {
      const next = [...prev, newField];
      onChange(serialise(next));
      return next;
    });
    setNewFieldKey("");
  }, [newFieldKey, newFieldType, fields, onChange, serialise]);

  const fieldCount = fields.length;
  const idField = useMemo(() => fields.find((f) => f.key === "_id"), [fields]);
  const otherFields = useMemo(() => fields.filter((f) => f.key !== "_id"), [fields]);

  if (fieldCount === 0 && !schema) {
    return (
      <div style={{ color: "#64748b", fontSize: 13, padding: "16px 0" }}>
        No schema available. Use JSON mode to edit this document.
      </div>
    );
  }

  return (
    <div style={{ overflowY: "auto", maxHeight: 420, paddingRight: 4 }}>
      {/* _id field at the top */}
      {idField && (
        <>
          <FieldRow
            key="_id"
            field={idField}
            isId
            isEditing={isEditing}
            onChange={handleChange}
            onRemove={handleRemove}
          />
          <hr style={{ border: "none", borderTop: "1px solid #1e293b", margin: "8px 0 14px" }} />
        </>
      )}

      {/* All other fields */}
      {otherFields.map((f) => (
        <FieldRow
          key={f.key}
          field={f}
          isId={false}
          isEditing={isEditing}
          onChange={handleChange}
          onRemove={handleRemove}
        />
      ))}

      {/* Add new field */}
      <div style={{ marginTop: 12, padding: "10px 12px", background: "#0f172a", borderRadius: 8, border: "1px dashed #334155" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 8, letterSpacing: "0.05em", textTransform: "uppercase" }}>
          Add field
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="text"
            placeholder="Field name"
            value={newFieldKey}
            onChange={(e) => { setNewFieldKey(e.target.value); setAddError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleAddField(); }}
            style={{ ...inputStyle, flex: 2 }}
          />
          <select
            value={newFieldType}
            onChange={(e) => setNewFieldType(e.target.value)}
            style={{ ...inputStyle, flex: 1 }}
          >
            {["string", "int", "double", "long", "decimal", "bool", "date", "objectId", "object", "array"].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <button
            onClick={handleAddField}
            style={{
              padding: "6px 14px",
              background: "#1e3a5f",
              border: "1px solid #3b82f6",
              borderRadius: 6,
              color: "#93c5fd",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            Add
          </button>
        </div>
        {addError && <div style={{ color: "#ef4444", fontSize: 12, marginTop: 6 }}>{addError}</div>}
      </div>
    </div>
  );
};

export default DocFormEditor;
