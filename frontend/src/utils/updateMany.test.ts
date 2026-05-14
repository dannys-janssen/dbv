import { describe, expect, it } from "vitest";
import { buildUpdateManyCommand, parseUpdateManyInput } from "./updateMany";

describe("parseUpdateManyInput", () => {
  it("parses tuple-style input", () => {
    const parsed = parseUpdateManyInput(
      '(\n  { "status": "inactive" },\n  { "$set": { "archived": true } }\n)'
    );

    expect(parsed).toEqual({
      filter: { status: "inactive" },
      update: { $set: { archived: true } },
    });
  });

  it("parses object-style input", () => {
    const parsed = parseUpdateManyInput(
      '{ "filter": { "status": "inactive" }, "update": { "$set": { "archived": true } } }'
    );

    expect(parsed).toEqual({
      filter: { status: "inactive" },
      update: { $set: { archived: true } },
    });
  });

  it("throws on invalid input", () => {
    expect(() => parseUpdateManyInput('{ "status": "inactive" }')).toThrow();
  });
});

describe("buildUpdateManyCommand", () => {
  it("builds a MongoDB update command with multi=true", () => {
    expect(
      buildUpdateManyCommand("users", {
        filter: { status: "inactive" },
        update: { $set: { archived: true } },
      })
    ).toEqual({
      update: "users",
      updates: [
        {
          q: { status: "inactive" },
          u: { $set: { archived: true } },
          multi: true,
        },
      ],
    });
  });
});
