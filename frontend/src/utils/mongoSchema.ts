import type { CollectionSchema } from "../api/mongo";

// ── Extended JSON type schemas ────────────────────────────────────────────────

/** JSON Schema for a BSON Date expressed as MongoDB Extended JSON. */
const DATE_SCHEMA = {
  oneOf: [
    {
      type: "object",
      description: 'BSON Date — {"$date": "2024-01-01T00:00:00.000Z"}',
      properties: { $date: { type: "string", description: "ISO 8601 datetime string" } },
      required: ["$date"],
      additionalProperties: false,
    },
    {
      type: "object",
      description: 'BSON Date (canonical) — {"$date": {"$numberLong": "…"}}',
      properties: {
        $date: {
          type: "object",
          properties: { $numberLong: { type: "string", description: "Milliseconds since epoch" } },
          required: ["$numberLong"],
        },
      },
      required: ["$date"],
      additionalProperties: false,
    },
  ],
};

/** JSON Schema for a BSON ObjectId expressed as MongoDB Extended JSON. */
const OBJECT_ID_SCHEMA = {
  type: "object",
  description: 'BSON ObjectId — {"$oid": "507f1f77bcf86cd799439011"}',
  properties: {
    $oid: { type: "string", pattern: "^[0-9a-fA-F]{24}$", description: "24 hex characters" },
  },
  required: ["$oid"],
  additionalProperties: false,
};

/** JSON Schema for a BSON Binary (UUID subtype 04) expressed as Extended JSON. */
const UUID_SCHEMA = {
  type: "object",
  description: 'BSON UUID — {"$binary": {"base64": "…", "subType": "04"}}',
  properties: {
    $binary: {
      type: "object",
      properties: {
        base64: { type: "string", description: "Base64-encoded bytes" },
        subType: { type: "string", enum: ["04", "03", "00", "05"], description: "BSON binary subtype" },
      },
      required: ["base64", "subType"],
    },
  },
  required: ["$binary"],
  additionalProperties: false,
};

/** JSON Schema for a BSON Int64 / NumberLong expressed as Extended JSON. */
const LONG_SCHEMA = {
  oneOf: [
    { type: "number", description: "64-bit integer (safe range)" },
    {
      type: "object",
      description: 'BSON NumberLong — {"$numberLong": "123456789012345"}',
      properties: { $numberLong: { type: "string", description: "64-bit integer as string" } },
      required: ["$numberLong"],
      additionalProperties: false,
    },
  ],
};

/** JSON Schema for a BSON Decimal128 expressed as Extended JSON. */
const DECIMAL_SCHEMA = {
  oneOf: [
    { type: "number" },
    {
      type: "object",
      description: 'BSON Decimal128 — {"$numberDecimal": "3.14159"}',
      properties: { $numberDecimal: { type: "string" } },
      required: ["$numberDecimal"],
      additionalProperties: false,
    },
  ],
};

// ── Type mapping ──────────────────────────────────────────────────────────────

/** Map BSON type names to JSON Schema fragments (including Extended JSON shapes). */
function bsonTypeToSchema(type: string): object {
  switch (type) {
    case "Date":       return DATE_SCHEMA;
    case "ObjectId":   return OBJECT_ID_SCHEMA;
    case "UUID":       return UUID_SCHEMA;
    case "BinData":    return UUID_SCHEMA;
    case "Int64":      return LONG_SCHEMA;
    case "Decimal128": return DECIMAL_SCHEMA;
    case "String":     return { type: "string" };
    case "Int32":      return { type: "integer" };
    case "Double":     return { type: "number" };
    case "Boolean":    return { type: "boolean" };
    case "Array":      return { type: "array" };
    case "Document":
    case "Object":     return { type: "object" };
    case "Null":       return { type: "null" };
    default:           return {};
  }
}

/** Combine multiple BSON types into a single JSON Schema. */
function bsonTypesToSchema(types: string[]): object {
  const schemas = types.map(bsonTypeToSchema).filter((s) => Object.keys(s).length > 0);
  if (schemas.length === 0) return {};
  if (schemas.length === 1) return schemas[0];
  return { oneOf: schemas };
}

// ── Schema builders ───────────────────────────────────────────────────────────

// Build a JSON Schema for the document create/edit editor
export function buildDocumentSchema(schema: CollectionSchema): object {
  const properties: Record<string, object> = {};
  for (const field of schema.fields) {
    if (field.path.includes(".")) continue; // skip nested (Monaco resolves by dotted path)
    const pct = Math.round(field.coverage * 100);
    const typeSchema = bsonTypesToSchema(field.types);
    properties[field.path] = {
      ...typeSchema,
      description: `${field.types.join(" | ")} · ${pct}% coverage${field.nullable ? " · nullable" : ""}`,
    };
  }
  return { type: "object", properties };
}

// Operators available in a query expression
const QUERY_OPS: Record<string, object> = {
  $eq:        { description: "Equal to" },
  $ne:        { description: "Not equal to" },
  $gt:        { description: "Greater than" },
  $gte:       { description: "Greater than or equal" },
  $lt:        { description: "Less than" },
  $lte:       { description: "Less than or equal" },
  $in:        { type: "array", description: "Match any value in array" },
  $nin:       { type: "array", description: "Exclude values in array" },
  $exists:    { type: "boolean", description: "Field exists check" },
  $type:      { description: "Match BSON type" },
  $regex:     { type: "string", description: "Regular expression pattern" },
  $options:   { type: "string", description: "Regex options (i, m, s, x)" },
  $elemMatch: { type: "object", description: "Array element match" },
  $size:      { type: "integer", description: "Array size" },
  $all:       { type: "array", description: "Match all values in array" },
  $not:       { type: "object", description: "Logical NOT" },
  $mod:       { type: "array", description: "Modulo check [divisor, remainder]" },
};

// Build a JSON Schema for the filter query editor
export function buildFilterSchema(schema: CollectionSchema): object {
  const properties: Record<string, object> = {};
  for (const field of schema.fields) {
    if (field.path.includes(".")) continue;
    const typeSchema = bsonTypesToSchema(field.types);
    properties[field.path] = {
      oneOf: [
        { ...typeSchema, description: `Direct match on ${field.path}` },
        { type: "object", properties: QUERY_OPS, description: "Query operators" },
      ],
    };
  }
  return {
    type: "object",
    properties: {
      ...properties,
      $and:  { type: "array", items: { type: "object" }, description: "All conditions must match" },
      $or:   { type: "array", items: { type: "object" }, description: "Any condition must match" },
      $nor:  { type: "array", items: { type: "object" }, description: "No condition must match" },
      $text: { type: "object", description: "Full-text search" },
      $where:{ type: "string", description: "JavaScript expression (server-side)" },
      $expr: { description: "Aggregation expression in query" },
    },
    additionalProperties: {
      oneOf: [{}, { type: "object", properties: QUERY_OPS }],
    },
  };
}

// Build a JSON Schema for the sort editor
export function buildSortSchema(schema: CollectionSchema): object {
  const properties: Record<string, object> = {};
  for (const field of schema.fields) {
    if (field.path.includes(".")) continue;
    properties[field.path] = {
      type: "integer",
      enum: [1, -1],
      description: `Sort by ${field.path}: 1 = ascending, -1 = descending`,
    };
  }
  return {
    type: "object",
    properties,
    additionalProperties: { type: "integer", enum: [1, -1] },
  };
}

// Static JSON Schema for the aggregation pipeline editor
export const PIPELINE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    maxProperties: 1,
    properties: {
      $match:       { type: "object", description: "Filter documents" },
      $project:     { type: "object", description: "Reshape documents — include/exclude/compute fields" },
      $group:       { type: "object", description: "Group by _id expression, compute accumulators" },
      $sort:        { type: "object", description: "Sort documents (1 asc, -1 desc)" },
      $limit:       { type: "integer", description: "Limit output to N documents" },
      $skip:        { type: "integer", description: "Skip first N documents" },
      $unwind:      { description: "Deconstruct an array field into multiple documents" },
      $lookup:      { type: "object", description: "Left-outer join from another collection" },
      $addFields:   { type: "object", description: "Add or overwrite fields" },
      $set:         { type: "object", description: "Alias for $addFields" },
      $unset:       { description: "Remove one or more fields" },
      $replaceRoot: { type: "object", description: "Replace root document with sub-document" },
      $replaceWith: { description: "Shorthand for { $replaceRoot: { newRoot: … } }" },
      $count:       { type: "string", description: "Count pipeline documents into a named field" },
      $facet:       { type: "object", description: "Multi-facet aggregation in a single pass" },
      $bucket:      { type: "object", description: "Categorise documents into buckets" },
      $bucketAuto:  { type: "object", description: "Auto-bucketing into N equal buckets" },
      $sortByCount: { description: "Group and sort by expression count" },
      $out:         { type: "string", description: "Write results to a collection" },
      $merge:       { description: "Merge results into a collection" },
      $sample:      { type: "object", description: "Randomly sample N documents" },
      $geoNear:     { type: "object", description: "Geospatial nearest-documents query" },
      $graphLookup: { type: "object", description: "Recursive graph lookup" },
      $redact:      { description: "Conditionally restrict document content" },
      $indexStats:  { type: "object", description: "Report index usage statistics" },
      $collStats:   { type: "object", description: "Collection / index statistics" },
      $densify:     { type: "object", description: "Fill gaps in time-series / numeric sequences" },
      $fill:        { type: "object", description: "Fill null/missing field values" },
      $setWindowFields: { type: "object", description: "Compute window functions over ordered partitions" },
    },
  },
};
