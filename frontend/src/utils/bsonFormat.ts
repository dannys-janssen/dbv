/**
 * Format a BSON Extended JSON value as a human-readable string.
 *
 * Handles both relaxed and canonical Extended JSON forms produced by the
 * bson crate's serde serialiser, e.g.:
 *   {"$date": {"$numberLong": "1775174388000"}}  → "2026-04-03T20:57:47.000Z"
 *   {"$date": "2024-01-01T00:00:00Z"}            → "2024-01-01T00:00:00.000Z"
 *   {"$oid": "507f1f77bcf86cd799439011"}          → "507f1f77bcf86cd799439011"
 *   {"$numberLong": "9007199254740993"}           → "9007199254740993"
 */
export function formatBsonValue(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (typeof v === "string") return `"${v}"`;
  if (Array.isArray(v)) return `[…${(v as unknown[]).length}]`;

  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;

    if ("$oid" in obj) return String(obj["$oid"]);

    if ("$date" in obj) {
      const d = obj["$date"];
      if (typeof d === "string") return new Date(d).toISOString();
      if (typeof d === "number") return new Date(d).toISOString();
      // Canonical form: {"$date": {"$numberLong": "ms-since-epoch"}}
      if (typeof d === "object" && d !== null && "$numberLong" in (d as object)) {
        const ms = Number((d as Record<string, unknown>)["$numberLong"]);
        return new Date(ms).toISOString();
      }
      return JSON.stringify(obj); // unexpected shape
    }

    if ("$numberInt" in obj)     return String(obj["$numberInt"]);
    if ("$numberLong" in obj)    return String(obj["$numberLong"]);
    if ("$numberDouble" in obj)  return String(obj["$numberDouble"]);
    if ("$numberDecimal" in obj) return String(obj["$numberDecimal"]);

    if ("$binary" in obj) {
      const bin = obj["$binary"] as Record<string, unknown> | undefined;
      const subType = bin?.["subType"];
      return subType === "04" || subType === "03" ? "[UUID]" : "[Binary]";
    }

    if ("$timestamp" in obj) return "[Timestamp]";
    if ("$regex" in obj)     return `/${obj["$regex"]}/`;
    if ("$minKey" in obj)    return "MinKey";
    if ("$maxKey" in obj)    return "MaxKey";

    const keys = Object.keys(obj);
    return keys.length === 0 ? "{}" : `{${keys.length} field${keys.length !== 1 ? "s" : ""}}`;
  }

  return String(v);
}

/** Returns true if a value should be rendered inline (no expand toggle needed). */
export function isBsonPrimitive(v: unknown): boolean {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return true;
  const obj = v as Record<string, unknown>;
  return (
    "$oid" in obj ||
    "$date" in obj ||
    "$numberInt" in obj ||
    "$numberLong" in obj ||
    "$numberDouble" in obj ||
    "$numberDecimal" in obj ||
    "$binary" in obj ||
    "$timestamp" in obj ||
    "$regex" in obj ||
    "$minKey" in obj ||
    "$maxKey" in obj
  );
}

/** CSS colour for a BSON value based on its type. */
export function bsonTypeColor(v: unknown): string {
  if (v === null) return "#94a3b8";
  if (typeof v === "boolean") return "#7c3aed";
  if (typeof v === "number") return "#0369a1";
  if (typeof v === "string") return "#15803d";
  if (Array.isArray(v)) return "#b45309";
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if ("$oid" in obj)   return "#6366f1";
    if ("$date" in obj)  return "#0891b2";
    if ("$numberInt" in obj || "$numberLong" in obj || "$numberDouble" in obj) return "#0369a1";
  }
  return "#374151";
}

/** Short type label for the tree-view badge. */
export function bsonTypeLabel(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `Array(${(v as unknown[]).length})`;
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if ("$oid" in obj)         return "ObjectId";
    if ("$date" in obj)        return "Date";
    if ("$numberInt" in obj)   return "Int32";
    if ("$numberLong" in obj)  return "Int64";
    if ("$numberDouble" in obj) return "Double";
    if ("$numberDecimal" in obj) return "Decimal128";
    if ("$binary" in obj)      return "Binary";
    if ("$timestamp" in obj)   return "Timestamp";
    return `Object(${Object.keys(obj).length})`;
  }
  return typeof v;
}
