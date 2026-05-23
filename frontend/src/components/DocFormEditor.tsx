/**
 * DocFormEditor.tsx
 *
 * A form-based document editor built from a CollectionSchema.
 * Each field gets a type-appropriate input widget:
 *   date       → date + time inputs (UTC)
 *   bool       → true / false radio buttons
 *   int/double → number input
 *   string     → text input
 *   objectId   → text input (24-char hex string)
 *   uuid       → text input (UUID string, e.g. "550e8400-e29b-41d4-a716-446655440000")
 *   object     → recursive sub-form (NestedObjectEditor)
 *   array      → list of item editors (NestedArrayEditor)
 *
 * Extra doc fields not found in the schema are shown with type-detected inputs.
 * The component is purely controlled: it receives a JSON string and emits
 * an updated JSON string on every change.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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

/** Extract a UUID string from a BSON $binary value (subtypes 03 and 04). */
function bsonBinaryToUuid(v: unknown): string {
  if (!v || typeof v !== "object") return "";
  const d = v as Record<string, unknown>;
  if (!d.$binary || typeof d.$binary !== "object") return "";
  const bin = d.$binary as Record<string, unknown>;
  const base64 = bin.base64;
  const subType = bin.subType;
  if (typeof base64 !== "string" || (subType !== "04" && subType !== "03")) return "";
  try {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    if (bytes.length !== 16) return "";
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  } catch {
    return "";
  }
}

/** Convert a UUID string back to a BSON $binary object (subtype 04). */
function uuidToBsonBinary(uuid: string): Record<string, unknown> {
  const hex = uuid.replace(/-/g, "");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  const base64 = btoa(String.fromCharCode(...bytes));
  return { $binary: { base64, subType: "04" } };
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
  // Normalise backend type names to their canonical internal equivalents:
  //   binary → uuid,  int32 → int,  int64 → long,  decimal128 → decimal
  const normalise = (t: string) =>
    t === "binary" ? "uuid" :
    t === "int32" ? "int" :
    t === "int64" ? "long" :
    t === "decimal128" ? "decimal" : t;
  const normalised = types.map(normalise);
  const priority = ["date", "objectId", "uuid", "bool", "int", "long", "double", "decimal", "string", "object", "array", "binData"];
  for (const t of priority) {
    if (normalised.includes(t)) return t;
  }
  return normalised[0] ?? "string";
}

/** True if this type maps to a simple scalar form control. */
function isSimpleType(t: string): boolean {
  return ["date", "bool", "int", "long", "double", "decimal", "string", "objectId", "uuid"].includes(t);
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
  /** For scalar types, the edited string/boolean. Unused for object/array (see children/arrayItems). */
  displayValue: string;
  isNull: boolean;
  fromSchema: boolean;
  /** Sub-fields for type === "object" (non-null). */
  children?: FieldState[];
  /** Element states for type === "array" (non-null). */
  arrayItems?: FieldState[];
}

/**
 * Convert a document value + optional schema type into a FieldState.
 *
 * @param key                  Field key / array index.
 * @param v                    Raw BSON-extended-JSON value.
 * @param schemaType           Type from the schema (or null to auto-detect).
 * @param childrenSchemaPrefix Dot-path prefix used when looking up sub-field
 *                             types in the schema.  For a regular object field
 *                             this is the field's own full path (e.g. "address").
 *                             For array items it is the *array*'s full path so
 *                             that sub-field lookups resolve to "items.name"
 *                             rather than "items.0.name".
 * @param schema               Full collection schema for recursive type lookup.
 */
function docValueToFieldState(
  key: string,
  v: unknown,
  schemaType: string | null,
  childrenSchemaPrefix: string,
  schema: CollectionSchema | null | undefined,
): FieldState {
  const isNull = v === null || v === undefined;
  const type = schemaType ?? detectValueType(v);

  let displayValue = "";
  let children: FieldState[] | undefined;
  let arrayItems: FieldState[] | undefined;

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
      case "uuid":
        displayValue = bsonBinaryToUuid(v);
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
      case "object": {
        if (typeof v === "object" && v !== null && !Array.isArray(v)) {
          const obj = v as Record<string, unknown>;
          children = Object.entries(obj).map(([k, val]) => {
            const childPath = childrenSchemaPrefix ? `${childrenSchemaPrefix}.${k}` : k;
            const schemaField = schema?.fields.find((f) => f.path === childPath);
            const childType = schemaField ? pickDominantType(schemaField.types) : null;
            return docValueToFieldState(k, val, childType, childPath, schema);
          });
        } else {
          children = [];
        }
        break;
      }
      case "array": {
        if (Array.isArray(v)) {
          arrayItems = (v as unknown[]).map((item, i) =>
            // Pass childrenSchemaPrefix (the array's own path) so that object
            // items look up sub-fields as "items.field" rather than "items.0.field".
            docValueToFieldState(String(i), item, null, childrenSchemaPrefix, schema),
          );
        } else {
          arrayItems = [];
        }
        break;
      }
      default:
        displayValue = safeStringify(v);
    }
  }

  return { key, type, displayValue, isNull, fromSchema: schemaType !== null, children, arrayItems };
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
    case "uuid":
      return f.displayValue ? uuidToBsonBinary(f.displayValue) : null;
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
    case "object": {
      if (f.children !== undefined) {
        const obj: Record<string, unknown> = {};
        for (const child of f.children) {
          obj[child.key] = fieldStateToBsonValue(child);
        }
        return obj;
      }
      return safeParse(f.displayValue);
    }
    case "array": {
      if (f.arrayItems !== undefined) {
        return f.arrayItems.map((item) => fieldStateToBsonValue(item));
      }
      return safeParse(f.displayValue);
    }
    default:
      return safeParse(f.displayValue);
  }
}

// ── sub-components ────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: "#1e293b",
  marginBottom: 4,
  textAlign: "left",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 6,
  color: "#f1f5f9",
  fontSize: 15,
  boxSizing: "border-box",
  outline: "none",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  fontFamily: "monospace",
  resize: "vertical",
  minHeight: 100,
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
  /** Full collection schema, passed down for nested-field type lookups. */
  schema?: CollectionSchema | null;
  /**
   * The full dot-path of the PARENT object/array.  Used to compute this
   * field's own schema path for rendering nested editors.
   * E.g. "" for top-level, "address" for fields inside the address object.
   */
  pathPrefix?: string;
  /**
   * Override for the schema lookup path of this field itself.  Normally
   * computed as `${pathPrefix}.${field.key}` but for array items it must
   * equal the array's path (so sub-fields use "items.field" not "items.0.field").
   */
  schemaPath?: string;
  onChange: (key: string, update: Partial<FieldState>) => void;
  onRemove: (key: string) => void;
}

// All three sub-components (FieldRow, NestedObjectEditor, NestedArrayEditor) are
// defined as function declarations so they can mutually reference each other via
// JSX without triggering TypeScript's "used before declaration" error.

function FieldRow({ field, isId, isEditing, schema, pathPrefix = "", schemaPath, onChange, onRemove }: FieldRowProps): React.ReactElement {
  const { t } = useTranslation();
  const readOnly = isId && isEditing;
  // Full schema path for this field — used as the pathPrefix for nested editors.
  const currentSchemaPath = schemaPath ?? (pathPrefix ? `${pathPrefix}.${field.key}` : field.key);
  // Display label: show "[0]" for valid array-index keys (non-negative integers
  // with no leading zeros, e.g. "0", "1", "12"), but not for names like "007".
  const displayKey = Number.isInteger(Number(field.key)) && String(parseInt(field.key, 10)) === field.key
    ? `[${field.key}]`
    : field.key;

  const handleNull = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(field.key, { isNull: e.target.checked });
  };

  const handleValue = (val: string) => {
    onChange(field.key, { displayValue: val, isNull: false });
  };

  const handleType = (newType: string) => {
    onChange(field.key, {
      type: newType,
      displayValue: "",
      isNull: false,
      children: newType === "object" ? [] : undefined,
      arrayItems: newType === "array" ? [] : undefined,
    });
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
        <label style={{ ...labelStyle, marginBottom: 0, flex: 1 }}>
          {displayKey}
          <span style={typeTagStyle(field.type)}>{field.type}</span>
        </label>

        {/* Type selector for non-id, non-schema fields */}
        {!field.fromSchema && !isId && (
          <select
            value={field.type}
            onChange={(e) => handleType(e.target.value)}
            aria-label={`${t("form.label.type")} for ${field.key}`}
            style={{
              ...inputStyle,
              width: "auto",
              fontSize: 11,
              padding: "2px 6px",
              marginLeft: 8,
            }}
          >
            {["string", "int", "double", "long", "decimal", "bool", "date", "objectId", "uuid", "object", "array"].map((tp) => (
              <option key={tp} value={tp}>{tp}</option>
            ))}
          </select>
        )}

        {/* Null toggle */}
        {!readOnly && (
          <label style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 8, fontSize: 11, color: "#64748b", cursor: "pointer" }}>
            <input type="checkbox" checked={field.isNull} onChange={handleNull} style={{ accentColor: "#64748b" }} aria-label={`${t("form.button.setNull")} ${field.key}`} />
            null
          </label>
        )}

        {/* Remove button — all fields except _id can be removed */}
        {!isId && (
          <button
            onClick={() => onRemove(field.key)}
            title={t("form.button.removeField.title")}
            aria-label={`${t("form.button.remove")} ${field.key}`}
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
          >{t("form.button.remove")}</button>
        )}
      </div>

      {field.isNull || readOnly ? (
        <input
          type="text"
          readOnly
          value={readOnly ? (field.displayValue || field.key) : t("form.value.null")}
          style={{ ...inputStyle, opacity: 0.5, cursor: "not-allowed" }}
        />
      ) : field.type === "bool" ? (
        <div style={{ display: "flex", gap: 16, padding: "6px 10px", background: "#1e293b", border: "1px solid #334155", borderRadius: 6 }}>
          {(["true", "false"] as const).map((opt) => (
            <label key={opt} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "#f1f5f9", fontSize: 14, userSelect: "none" }}>
              <input
                type="radio"
                name={`bool-${field.key}`}
                value={opt}
                checked={field.displayValue === opt}
                onChange={() => handleValue(opt)}
                style={{ accentColor: "#3b82f6", cursor: "pointer" }}
              />
              {opt === "true" ? t("form.option.true") : t("form.option.false")}
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
                aria-label={`${t("form.label.date")} for ${field.key}`}
              />
              <input
                type="time"
                value={timePart}
                onChange={(e) => handleValue(`${datePart}|${e.target.value}`)}
                step="1"
                style={{ ...inputStyle, flex: 1, colorScheme: "dark" }}
                aria-label={`${t("form.label.time")} for ${field.key}`}
              />
              <span style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap" }}>{t("form.label.utc")}</span>
            </div>
          );
        })()
      ) : isSimpleType(field.type) ? (
        <input
          type={["int", "double", "long", "decimal"].includes(field.type) ? "number" : "text"}
          value={field.displayValue}
          onChange={(e) => handleValue(e.target.value)}
          placeholder={
            field.type === "objectId" ? t("form.placeholder.objectId") :
            field.type === "uuid" ? t("form.placeholder.uuid") : ""
          }
          step={field.type === "double" || field.type === "decimal" ? "any" : undefined}
          style={inputStyle}
        />
      ) : field.type === "object" && field.children !== undefined ? (
        <NestedObjectEditor
          parentKey={field.key}
          children={field.children}
          isEditing={isEditing}
          schema={schema}
          pathPrefix={currentSchemaPath}
          onChange={onChange}
        />
      ) : field.type === "array" && field.arrayItems !== undefined ? (
        <NestedArrayEditor
          parentKey={field.key}
          arrayItems={field.arrayItems}
          isEditing={isEditing}
          schema={schema}
          pathPrefix={currentSchemaPath}
          onChange={onChange}
        />
      ) : (
        <textarea
          value={field.displayValue}
          onChange={(e) => handleValue(e.target.value)}
          placeholder={t("form.placeholder.jsonValue")}
          style={textareaStyle}
          spellCheck={false}
        />
      )}
    </div>
  );
}

// ── NestedObjectEditor ────────────────────────────────────────────────────────

interface NestedObjectEditorProps {
  parentKey: string;
  children: FieldState[];
  isEditing: boolean;
  schema: CollectionSchema | null | undefined;
  /** Full schema path of the parent object, e.g. "address". */
  pathPrefix: string;
  onChange: (key: string, update: Partial<FieldState>) => void;
}

function NestedObjectEditor({ parentKey, children, isEditing, schema, pathPrefix, onChange }: NestedObjectEditorProps): React.ReactElement {
  const { t } = useTranslation();
  const [newChildKey, setNewChildKey] = useState("");
  const [newChildType, setNewChildType] = useState("string");
  const [addError, setAddError] = useState("");

  const handleChildChange = (childKey: string, update: Partial<FieldState>) => {
    const newChildren = children.map((c) => (c.key === childKey ? { ...c, ...update } : c));
    onChange(parentKey, { children: newChildren });
  };

  const handleChildRemove = (childKey: string) => {
    const newChildren = children.filter((c) => c.key !== childKey);
    onChange(parentKey, { children: newChildren });
  };

  const handleAddChild = () => {
    const key = newChildKey.trim();
    if (!key) { setAddError(t("form.validation.fieldNameRequired")); return; }
    if (children.some((c) => c.key === key)) { setAddError(t("form.validation.fieldExists", { key })); return; }
    setAddError("");
    const childFullPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    const schemaField = schema?.fields.find((f) => f.path === childFullPath);
    const resolvedType = schemaField ? pickDominantType(schemaField.types) : newChildType;
    const newChild: FieldState = {
      key,
      type: resolvedType,
      displayValue: "",
      isNull: false,
      fromSchema: !!schemaField,
      children: resolvedType === "object" ? [] : undefined,
      arrayItems: resolvedType === "array" ? [] : undefined,
    };
    onChange(parentKey, { children: [...children, newChild] });
    setNewChildKey("");
  };

  return (
    <div style={{ paddingLeft: 14, borderLeft: "2px solid #1e3a5f", marginTop: 6, marginBottom: 4 }}>
      {children.length === 0 && (
        <div style={{ fontSize: 12, color: "#475569", padding: "4px 0 8px" }}>{t("form.nested.empty")}</div>
      )}
      {children.map((child) => (
        <FieldRow
          key={child.key}
          field={child}
          isId={false}
          isEditing={isEditing}
          schema={schema}
          pathPrefix={pathPrefix}
          onChange={handleChildChange}
          onRemove={handleChildRemove}
        />
      ))}
      {/* Add sub-field */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
        <input
          type="text"
          placeholder={t("form.labels.fieldName")}
          value={newChildKey}
          onChange={(e) => { setNewChildKey(e.target.value); setAddError(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") handleAddChild(); }}
          style={{ ...inputStyle, flex: 2, fontSize: 12, padding: "4px 8px" }}
          aria-label={t("form.label.newFieldName")}
        />
        <select
          value={newChildType}
          onChange={(e) => setNewChildType(e.target.value)}
          style={{ ...inputStyle, flex: 1, fontSize: 12, padding: "4px 8px" }}
          aria-label={t("form.label.newFieldType")}
        >
          {["string", "int", "double", "long", "decimal", "bool", "date", "objectId", "uuid", "object", "array"].map((tp) => (
            <option key={tp} value={tp}>{tp}</option>
          ))}
        </select>
        <button
          onClick={handleAddChild}
          style={{ padding: "4px 10px", background: "#1e3a5f", border: "1px solid #3b82f6", borderRadius: 6, color: "#93c5fd", cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}
        >
          {t("buttons.add")}
        </button>
      </div>
      {addError && <div style={{ color: "#ef4444", fontSize: 11, marginTop: 4 }}>{addError}</div>}
    </div>
  );
}

// ── NestedArrayEditor ─────────────────────────────────────────────────────────

interface NestedArrayEditorProps {
  parentKey: string;
  arrayItems: FieldState[];
  isEditing: boolean;
  schema: CollectionSchema | null | undefined;
  /** Full schema path of the parent array, e.g. "tags" or "items". */
  pathPrefix: string;
  onChange: (key: string, update: Partial<FieldState>) => void;
}

function NestedArrayEditor({ parentKey, arrayItems, isEditing, schema, pathPrefix, onChange }: NestedArrayEditorProps): React.ReactElement {
  const { t } = useTranslation();
  const [newItemType, setNewItemType] = useState("string");

  const handleItemChange = (itemKey: string, update: Partial<FieldState>) => {
    const newItems = arrayItems.map((item) => (item.key === itemKey ? { ...item, ...update } : item));
    onChange(parentKey, { arrayItems: newItems });
  };

  const handleItemRemove = (itemKey: string) => {
    // Remove the item and re-index remaining items.
    const newItems = arrayItems
      .filter((item) => item.key !== itemKey)
      .map((item, i) => ({ ...item, key: String(i) }));
    onChange(parentKey, { arrayItems: newItems });
  };

  const handleAddItem = () => {
    const newItem: FieldState = {
      key: String(arrayItems.length),
      type: newItemType,
      displayValue: "",
      isNull: false,
      fromSchema: false,
      children: newItemType === "object" ? [] : undefined,
      arrayItems: newItemType === "array" ? [] : undefined,
    };
    onChange(parentKey, { arrayItems: [...arrayItems, newItem] });
  };

  return (
    <div style={{ paddingLeft: 14, borderLeft: "2px solid #0e4429", marginTop: 6, marginBottom: 4 }}>
      {arrayItems.length === 0 && (
        <div style={{ fontSize: 12, color: "#475569", padding: "4px 0 8px" }}>{t("form.array.empty")}</div>
      )}
      {arrayItems.map((item) => (
        <FieldRow
          key={item.key}
          field={item}
          isId={false}
          isEditing={isEditing}
          schema={schema}
          // Array items pass pathPrefix as schemaPath so that object-type items
          // look up sub-fields as "items.field" rather than "items.0.field".
          pathPrefix={pathPrefix}
          schemaPath={pathPrefix}
          onChange={handleItemChange}
          onRemove={handleItemRemove}
        />
      ))}
      {/* Add item */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
        <select
          value={newItemType}
          onChange={(e) => setNewItemType(e.target.value)}
          style={{ ...inputStyle, flex: 1, fontSize: 12, padding: "4px 8px" }}
          aria-label={t("form.label.newItemType")}
        >
          {["string", "int", "double", "long", "decimal", "bool", "date", "objectId", "uuid", "object", "array"].map((tp) => (
            <option key={tp} value={tp}>{tp}</option>
          ))}
        </select>
        <button
          onClick={handleAddItem}
          style={{ padding: "4px 10px", background: "#14532d", border: "1px solid #22c55e", borderRadius: 6, color: "#86efac", cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}
        >
          {t("form.button.addItem")}
        </button>
      </div>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

interface DocFormEditorProps {
  schema: CollectionSchema | null;
  value: string;   // current JSON document string
  onChange: (json: string) => void;
  isEditing: boolean; // true when editing an existing doc, false when creating
}

const DocFormEditor: React.FC<DocFormEditorProps> = ({ schema, value, onChange, isEditing }) => {
  const { t } = useTranslation();
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
      result.push(docValueToFieldState(key, v, schemaType, key, schema));
    }

    // Extra fields in the doc not covered by schema
    for (const key of Object.keys(doc)) {
      if (!schemaTopLevel.has(key)) {
        result.push(docValueToFieldState(key, doc[key], null, key, schema));
      }
    }

    setFields(result);
  }, [schema]);

  // Initialise whenever the incoming JSON or schema changes (only on open)
  const prevValue = React.useRef<string>("");
  useEffect(() => {
    if (value !== prevValue.current) {
      prevValue.current = value;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reinitialises fields when value prop changes
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
    if (!key) { setAddError(t("form.validation.fieldNameRequired")); return; }
    if (fields.some((f) => f.key === key)) { setAddError(t("form.validation.fieldExists", { key })); return; }
    setAddError("");
    const newField: FieldState = {
      key,
      type: newFieldType,
      displayValue: "",
      isNull: false,
      fromSchema: false,
      children: newFieldType === "object" ? [] : undefined,
      arrayItems: newFieldType === "array" ? [] : undefined,
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
        {t("editor.form.noSchema")}
      </div>
    );
  }

  return (
    <div style={{ overflowY: "auto", maxHeight: "calc(90vh - 200px)", paddingRight: 4 }}>
      {/* _id field at the top */}
      {idField && (
        <>
          <FieldRow
            key="_id"
            field={idField}
            isId
            isEditing={isEditing}
            schema={schema}
            pathPrefix=""
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
          schema={schema}
          pathPrefix=""
          onChange={handleChange}
          onRemove={handleRemove}
        />
      ))}

      {/* Add new field */}
      <div style={{ marginTop: 12, padding: "10px 12px", background: "#0f172a", borderRadius: 8, border: "1px dashed #334155" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 8, letterSpacing: "0.05em", textTransform: "uppercase" }}>
          {t("form.section.addField")}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="text"
            placeholder={t("form.labels.fieldName")}
            value={newFieldKey}
            onChange={(e) => { setNewFieldKey(e.target.value); setAddError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleAddField(); }}
            style={{ ...inputStyle, flex: 2 }}
            aria-label={t("form.label.newFieldName")}
          />
          <select
            value={newFieldType}
            onChange={(e) => setNewFieldType(e.target.value)}
            style={{ ...inputStyle, flex: 1 }}
            aria-label={t("form.label.newFieldType")}
          >
            {["string", "int", "double", "long", "decimal", "bool", "date", "objectId", "uuid", "object", "array"].map((tp) => (
              <option key={tp} value={tp}>{tp}</option>
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
            {t("buttons.add")}
          </button>
        </div>
        {addError && <div style={{ color: "#ef4444", fontSize: 12, marginTop: 6 }}>{addError}</div>}
      </div>
    </div>
  );
};

export default DocFormEditor;
