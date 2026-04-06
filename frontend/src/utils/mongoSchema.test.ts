import { describe, it, expect } from "vitest";
import type { CollectionSchema } from "../api/mongo";
import {
  buildDocumentSchema,
  buildFilterSchema,
  buildSortSchema,
  buildProjectionSchema,
  PIPELINE_SCHEMA,
} from "./mongoSchema";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSchema(fields: CollectionSchema["fields"]): CollectionSchema {
  return { sampled_documents: fields.length, fields };
}

// ── buildDocumentSchema ───────────────────────────────────────────────────────

describe("buildDocumentSchema", () => {
  it("returns a JSON Schema object type", () => {
    const schema = buildDocumentSchema(makeSchema([]));
    expect((schema as Record<string, unknown>).type).toBe("object");
  });

  it("includes top-level fields as properties", () => {
    const schema = buildDocumentSchema(
      makeSchema([
        { path: "name", types: ["String"], coverage: 1.0, nullable: false },
        { path: "age", types: ["Int32"], coverage: 0.8, nullable: false },
      ])
    );
    const props = (schema as Record<string, unknown>).properties as Record<string, unknown>;
    expect(props).toHaveProperty("name");
    expect(props).toHaveProperty("age");
  });

  it("excludes nested paths (containing '.')", () => {
    const schema = buildDocumentSchema(
      makeSchema([
        { path: "address.city", types: ["String"], coverage: 0.5, nullable: false },
        { path: "name", types: ["String"], coverage: 1.0, nullable: false },
      ])
    );
    const props = (schema as Record<string, unknown>).properties as Record<string, unknown>;
    expect(props).not.toHaveProperty("address.city");
    expect(props).toHaveProperty("name");
  });

  it("maps String type to JSON Schema string type", () => {
    const schema = buildDocumentSchema(
      makeSchema([{ path: "email", types: ["String"], coverage: 1.0, nullable: false }])
    );
    const props = (schema as Record<string, Record<string, unknown>>).properties;
    expect((props.email as Record<string, unknown>).type).toBe("string");
  });

  it("maps ObjectId type to BSON object schema", () => {
    const schema = buildDocumentSchema(
      makeSchema([{ path: "_id", types: ["ObjectId"], coverage: 1.0, nullable: false }])
    );
    const props = (schema as Record<string, Record<string, unknown>>).properties;
    expect(props._id).toBeTruthy();
    // ObjectId schema uses 'type: object' + required: ['$oid']
    const idSchema = props._id as Record<string, unknown>;
    expect(idSchema.type).toBe("object");
  });

  it("uses oneOf for multi-type fields", () => {
    const schema = buildDocumentSchema(
      makeSchema([{ path: "value", types: ["String", "Int32"], coverage: 1.0, nullable: false }])
    );
    const props = (schema as Record<string, Record<string, unknown>>).properties;
    const valueSchema = props.value as Record<string, unknown>;
    expect(valueSchema).toHaveProperty("oneOf");
    const oneOf = valueSchema.oneOf as unknown[];
    expect(oneOf.length).toBe(2);
  });

  it("includes coverage percentage and nullability in description", () => {
    const schema = buildDocumentSchema(
      makeSchema([{ path: "name", types: ["String"], coverage: 0.75, nullable: true }])
    );
    const props = (schema as Record<string, Record<string, unknown>>).properties;
    const description = (props.name as Record<string, unknown>).description as string;
    expect(description).toContain("75%");
    expect(description).toContain("nullable");
  });
});

// ── buildFilterSchema ─────────────────────────────────────────────────────────

describe("buildFilterSchema", () => {
  it("returns a JSON Schema object type", () => {
    const schema = buildFilterSchema(makeSchema([]));
    expect((schema as Record<string, unknown>).type).toBe("object");
  });

  it("includes logical operators $and, $or, $nor, $text, $where, $expr", () => {
    const schema = buildFilterSchema(makeSchema([]));
    const props = (schema as Record<string, unknown>).properties as Record<string, unknown>;
    expect(props).toHaveProperty("$and");
    expect(props).toHaveProperty("$or");
    expect(props).toHaveProperty("$nor");
    expect(props).toHaveProperty("$text");
    expect(props).toHaveProperty("$where");
    expect(props).toHaveProperty("$expr");
  });

  it("includes collection fields with oneOf (direct match + operators)", () => {
    const schema = buildFilterSchema(
      makeSchema([{ path: "status", types: ["String"], coverage: 1.0, nullable: false }])
    );
    const props = (schema as Record<string, Record<string, unknown>>).properties;
    expect(props).toHaveProperty("status");
    const statusSchema = props.status as Record<string, unknown>;
    expect(statusSchema).toHaveProperty("oneOf");
  });

  it("excludes nested paths", () => {
    const schema = buildFilterSchema(
      makeSchema([
        { path: "nested.field", types: ["String"], coverage: 1.0, nullable: false },
        { path: "top", types: ["String"], coverage: 1.0, nullable: false },
      ])
    );
    const props = (schema as Record<string, unknown>).properties as Record<string, unknown>;
    expect(props).not.toHaveProperty("nested.field");
    expect(props).toHaveProperty("top");
  });

  it("has additionalProperties to allow arbitrary fields with operators", () => {
    const schema = buildFilterSchema(makeSchema([]));
    expect((schema as Record<string, unknown>).additionalProperties).toBeTruthy();
  });
});

// ── buildSortSchema ───────────────────────────────────────────────────────────

describe("buildSortSchema", () => {
  it("returns a JSON Schema object type", () => {
    const schema = buildSortSchema(makeSchema([]));
    expect((schema as Record<string, unknown>).type).toBe("object");
  });

  it("includes fields with enum [1, -1]", () => {
    const schema = buildSortSchema(
      makeSchema([{ path: "age", types: ["Int32"], coverage: 1.0, nullable: false }])
    );
    const props = (schema as Record<string, Record<string, unknown>>).properties;
    expect(props).toHaveProperty("age");
    const ageSchema = props.age as Record<string, unknown>;
    expect(ageSchema.enum).toEqual([1, -1]);
    expect(ageSchema.type).toBe("integer");
  });

  it("excludes nested paths", () => {
    const schema = buildSortSchema(
      makeSchema([
        { path: "a.b", types: ["String"], coverage: 1.0, nullable: false },
        { path: "name", types: ["String"], coverage: 1.0, nullable: false },
      ])
    );
    const props = (schema as Record<string, unknown>).properties as Record<string, unknown>;
    expect(props).not.toHaveProperty("a.b");
    expect(props).toHaveProperty("name");
  });

  it("additionalProperties also enforces enum [1, -1]", () => {
    const schema = buildSortSchema(makeSchema([]));
    const additional = (schema as Record<string, Record<string, unknown>>).additionalProperties;
    expect(additional.enum).toEqual([1, -1]);
  });
});

// ── buildProjectionSchema ─────────────────────────────────────────────────────

describe("buildProjectionSchema", () => {
  it("returns a JSON Schema object type", () => {
    const schema = buildProjectionSchema(makeSchema([]));
    expect((schema as Record<string, unknown>).type).toBe("object");
  });

  it("always includes _id with enum [0, 1]", () => {
    const schema = buildProjectionSchema(makeSchema([]));
    const props = (schema as Record<string, Record<string, unknown>>).properties;
    expect(props).toHaveProperty("_id");
    expect((props._id as Record<string, unknown>).enum).toEqual([0, 1]);
  });

  it("includes collection fields with enum [0, 1]", () => {
    const schema = buildProjectionSchema(
      makeSchema([{ path: "email", types: ["String"], coverage: 1.0, nullable: false }])
    );
    const props = (schema as Record<string, Record<string, unknown>>).properties;
    expect(props).toHaveProperty("email");
    expect((props.email as Record<string, unknown>).enum).toEqual([0, 1]);
  });

  it("excludes nested paths", () => {
    const schema = buildProjectionSchema(
      makeSchema([
        { path: "a.b", types: ["String"], coverage: 1.0, nullable: false },
        { path: "top", types: ["String"], coverage: 1.0, nullable: false },
      ])
    );
    const props = (schema as Record<string, unknown>).properties as Record<string, unknown>;
    expect(props).not.toHaveProperty("a.b");
    expect(props).toHaveProperty("top");
  });
});

// ── PIPELINE_SCHEMA ───────────────────────────────────────────────────────────

describe("PIPELINE_SCHEMA", () => {
  it("is an array schema", () => {
    expect(PIPELINE_SCHEMA.type).toBe("array");
  });

  it("items has key aggregation stages", () => {
    const stages = Object.keys(PIPELINE_SCHEMA.items.properties);
    expect(stages).toContain("$match");
    expect(stages).toContain("$group");
    expect(stages).toContain("$project");
    expect(stages).toContain("$sort");
    expect(stages).toContain("$limit");
    expect(stages).toContain("$lookup");
    expect(stages).toContain("$unwind");
    expect(stages).toContain("$out");
  });

  it("items allows max 1 property (one stage per pipeline step)", () => {
    expect(PIPELINE_SCHEMA.items.maxProperties).toBe(1);
  });
});
