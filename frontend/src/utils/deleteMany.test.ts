import { describe, expect, it } from "vitest";
import { buildDeleteManyRequest, parseDeleteManyInput } from "./deleteMany";

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

describe("buildDeleteManyRequest", () => {
  it("builds a deleteMany request payload", () => {
    expect(
      buildDeleteManyRequest({
        filter: { status: "inactive" },
        options: { maxTimeMS: 30000 },
      })
    ).toEqual({
      filter: { status: "inactive" },
      options: { maxTimeMS: 30000 },
    });
  });
});
