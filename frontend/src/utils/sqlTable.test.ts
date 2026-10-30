import { describe, it, expect } from "vitest";
import { columnsForRows, formatBytes, formatCell, parseJsonField } from "./sqlTable";

describe("formatCell", () => {
  it("renders NULL for null and undefined", () => {
    expect(formatCell(null)).toBe("NULL");
    expect(formatCell(undefined)).toBe("NULL");
  });

  it("stringifies objects and arrays", () => {
    expect(formatCell({ a: 1 })).toBe('{"a":1}');
    expect(formatCell([1, 2])).toBe("[1,2]");
  });

  it("passes scalars through", () => {
    expect(formatCell(0)).toBe("0");
    expect(formatCell(false)).toBe("false");
    expect(formatCell("hi")).toBe("hi");
  });
});

describe("parseJsonField", () => {
  it("returns undefined for blank input", () => {
    expect(parseJsonField("")).toBeUndefined();
    expect(parseJsonField("   ")).toBeUndefined();
  });

  it("parses JSON objects", () => {
    expect(parseJsonField('{"id": 1}')).toEqual({ id: 1 });
  });

  it("returns null for invalid JSON or non-objects", () => {
    expect(parseJsonField("{id: 1}")).toBeNull();
    expect(parseJsonField("[1,2]")).toBeNull();
    expect(parseJsonField("7")).toBeNull();
    expect(parseJsonField("null")).toBeNull();
  });
});

describe("columnsForRows", () => {
  it("preserves server column order", () => {
    expect(columnsForRows(["id", "name"], [{ name: "a", id: 1 }])).toEqual(["id", "name"]);
  });

  it("appends keys missing from the server list", () => {
    expect(columnsForRows(["id"], [{ id: 1, extra: 2 }])).toEqual(["id", "extra"]);
  });

  it("derives columns from rows when the server sends none", () => {
    expect(columnsForRows(undefined, [{ a: 1 }, { b: 2 }])).toEqual(["a", "b"]);
  });

  it("returns an empty list for no columns and no rows", () => {
    expect(columnsForRows(undefined, [])).toEqual([]);
  });
});

describe("formatBytes", () => {
  it("scales units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.00 MB");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.00 GB");
  });
});
