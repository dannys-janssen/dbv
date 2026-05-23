import { describe, expect, it } from "vitest";
import { buildDeleteManyCommand, parseDeleteManyInput } from "./deleteMany";

describe("parseDeleteManyInput", () => {
  it("parses tuple-style input", () => {
    const parsed = parseDeleteManyInput(
      '(\n  { "status": "inactive" },\n  { "maxTimeMS": 30000 }\n)'
    );

    expect(parsed).toEqual({
      filter: { status: "inactive" },
      options: { maxTimeMS: 30000 },
    });
  });

  it("parses object-style input", () => {
    const parsed = parseDeleteManyInput(
      '{ "filter": { "status": "inactive" }, "options": { "maxTimeMS": 30000 } }'
    );

    expect(parsed).toEqual({
      filter: { status: "inactive" },
      options: { maxTimeMS: 30000 },
    });
  });

  it("defaults options to empty object", () => {
    const parsed = parseDeleteManyInput('{ "filter": { "status": "inactive" } }');

    expect(parsed).toEqual({
      filter: { status: "inactive" },
      options: {},
    });
  });

  it("throws on invalid input", () => {
    expect(() => parseDeleteManyInput('{ "status": "inactive" }')).toThrow();
  });
});

describe("buildDeleteManyCommand", () => {
  it("builds a MongoDB delete command with limit=0", () => {
    expect(
      buildDeleteManyCommand("users", {
        filter: { status: "inactive" },
        options: { maxTimeMS: 30000 },
      })
    ).toEqual({
      delete: "users",
      deletes: [
        {
          q: { status: "inactive" },
          limit: 0,
          maxTimeMS: 30000,
        },
      ],
    });
  });
});
