import type { CollectionSchema } from "../api/mongo";

// Map BSON types to JSON Schema types
function bsonToJsonType(types: string[]): object {
  const map: Record<string, string> = {
    String: "string",
    Int32: "number",
    Int64: "number",
    Double: "number",
    Decimal128: "number",
    Boolean: "boolean",
    Array: "array",
    Document: "object",
    Object: "object",
    ObjectId: "string",
    Date: "string",
    Null: "null",
  };
  const jsonTypes = [...new Set(types.flatMap((t) => (map[t] ? [map[t]] : [])))];
  if (jsonTypes.length === 0) return {};
  if (jsonTypes.length === 1) return { type: jsonTypes[0] };
  return { type: jsonTypes };
}

// Build a JSON Schema for the document create/edit editor
export function buildDocumentSchema(schema: CollectionSchema): object {
  const properties: Record<string, object> = {};
  for (const field of schema.fields) {
    if (field.path.includes(".")) continue; // skip nested (Monaco resolves by dotted path)
    const pct = Math.round(field.coverage * 100);
    properties[field.path] = {
      ...bsonToJsonType(field.types),
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
    properties[field.path] = {
      oneOf: [
        { ...bsonToJsonType(field.types), description: `Direct match on ${field.path}` },
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
