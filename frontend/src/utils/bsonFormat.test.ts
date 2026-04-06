import { describe, it, expect } from "vitest";
import { formatBsonValue, isBsonPrimitive, bsonTypeColor, bsonTypeLabel } from "./bsonFormat";

// ── formatBsonValue ───────────────────────────────────────────────────────────

describe("formatBsonValue", () => {
  it("formats null", () => {
    expect(formatBsonValue(null)).toBe("null");
  });

  it("formats boolean true", () => {
    expect(formatBsonValue(true)).toBe("true");
  });

  it("formats boolean false", () => {
    expect(formatBsonValue(false)).toBe("false");
  });

  it("formats a number", () => {
    expect(formatBsonValue(42)).toBe("42");
    expect(formatBsonValue(3.14)).toBe("3.14");
    expect(formatBsonValue(0)).toBe("0");
  });

  it("formats a string", () => {
    expect(formatBsonValue("hello")).toBe('"hello"');
    expect(formatBsonValue("")).toBe('""');
  });

  it("formats an array by showing length", () => {
    expect(formatBsonValue([1, 2, 3])).toBe("[…3]");
    expect(formatBsonValue([])).toBe("[…0]");
  });

  it("formats $oid", () => {
    expect(formatBsonValue({ $oid: "507f1f77bcf86cd799439011" })).toBe(
      "507f1f77bcf86cd799439011"
    );
  });

  it("formats $date as relaxed ISO string", () => {
    const result = formatBsonValue({ $date: "2024-01-15T10:30:00.000Z" });
    expect(result).toBe("2024-01-15T10:30:00.000Z");
  });

  it("formats $date as canonical form with $numberLong", () => {
    // 2024-01-15T10:30:00.000Z = 1705315800000 ms
    const result = formatBsonValue({ $date: { $numberLong: "1705315800000" } });
    expect(result).toBe(new Date(1705315800000).toISOString());
  });

  it("formats $date as number (milliseconds)", () => {
    const result = formatBsonValue({ $date: 1705315800000 });
    expect(result).toBe(new Date(1705315800000).toISOString());
  });

  it("falls back to JSON for unexpected $date shape", () => {
    const weird = { $date: { unexpected: true } };
    const result = formatBsonValue(weird);
    expect(result).toBe(JSON.stringify(weird));
  });

  it("formats $numberInt", () => {
    expect(formatBsonValue({ $numberInt: "42" })).toBe("42");
  });

  it("formats $numberLong", () => {
    expect(formatBsonValue({ $numberLong: "9007199254740993" })).toBe(
      "9007199254740993"
    );
  });

  it("formats $numberDouble", () => {
    expect(formatBsonValue({ $numberDouble: "3.14" })).toBe("3.14");
  });

  it("formats $numberDecimal", () => {
    expect(formatBsonValue({ $numberDecimal: "12345.6789" })).toBe("12345.6789");
  });

  it("formats $binary UUID subType 04 as [UUID]", () => {
    expect(formatBsonValue({ $binary: { base64: "abc", subType: "04" } })).toBe("[UUID]");
  });

  it("formats $binary UUID subType 03 as [UUID]", () => {
    expect(formatBsonValue({ $binary: { base64: "abc", subType: "03" } })).toBe("[UUID]");
  });

  it("formats $binary other subType as [Binary]", () => {
    expect(formatBsonValue({ $binary: { base64: "abc", subType: "00" } })).toBe("[Binary]");
  });

  it("formats $timestamp", () => {
    expect(formatBsonValue({ $timestamp: { t: 1, i: 0 } })).toBe("[Timestamp]");
  });

  it("formats $regex", () => {
    expect(formatBsonValue({ $regex: "^abc" })).toBe("/^abc/");
  });

  it("formats $minKey", () => {
    expect(formatBsonValue({ $minKey: 1 })).toBe("MinKey");
  });

  it("formats $maxKey", () => {
    expect(formatBsonValue({ $maxKey: 1 })).toBe("MaxKey");
  });

  it("formats an empty object", () => {
    expect(formatBsonValue({})).toBe("{}");
  });

  it("formats a plain object with field count", () => {
    expect(formatBsonValue({ a: 1, b: 2 })).toBe("{2 fields}");
    expect(formatBsonValue({ a: 1 })).toBe("{1 field}");
  });
});

// ── isBsonPrimitive ───────────────────────────────────────────────────────────

describe("isBsonPrimitive", () => {
  it("returns true for null", () => {
    expect(isBsonPrimitive(null)).toBe(true);
  });

  it("returns true for primitives", () => {
    expect(isBsonPrimitive(42)).toBe(true);
    expect(isBsonPrimitive("hello")).toBe(true);
    expect(isBsonPrimitive(true)).toBe(true);
  });

  it("returns true for arrays", () => {
    expect(isBsonPrimitive([1, 2, 3])).toBe(true);
  });

  it("returns true for BSON Extended JSON special types", () => {
    expect(isBsonPrimitive({ $oid: "abc" })).toBe(true);
    expect(isBsonPrimitive({ $date: "2024-01-01" })).toBe(true);
    expect(isBsonPrimitive({ $numberInt: "1" })).toBe(true);
    expect(isBsonPrimitive({ $numberLong: "1" })).toBe(true);
    expect(isBsonPrimitive({ $numberDouble: "1.0" })).toBe(true);
    expect(isBsonPrimitive({ $numberDecimal: "1.0" })).toBe(true);
    expect(isBsonPrimitive({ $binary: { base64: "", subType: "00" } })).toBe(true);
    expect(isBsonPrimitive({ $timestamp: { t: 1, i: 0 } })).toBe(true);
    expect(isBsonPrimitive({ $regex: "^a" })).toBe(true);
    expect(isBsonPrimitive({ $minKey: 1 })).toBe(true);
    expect(isBsonPrimitive({ $maxKey: 1 })).toBe(true);
  });

  it("returns false for plain objects", () => {
    expect(isBsonPrimitive({ a: 1 })).toBe(false);
    expect(isBsonPrimitive({})).toBe(false);
  });
});

// ── bsonTypeColor ─────────────────────────────────────────────────────────────

describe("bsonTypeColor", () => {
  it("returns grey for null", () => {
    expect(bsonTypeColor(null)).toBe("#94a3b8");
  });

  it("returns purple for boolean", () => {
    expect(bsonTypeColor(true)).toBe("#7c3aed");
    expect(bsonTypeColor(false)).toBe("#7c3aed");
  });

  it("returns blue for number", () => {
    expect(bsonTypeColor(42)).toBe("#0369a1");
  });

  it("returns green for string", () => {
    expect(bsonTypeColor("hello")).toBe("#15803d");
  });

  it("returns amber for array", () => {
    expect(bsonTypeColor([])).toBe("#b45309");
  });

  it("returns indigo for $oid", () => {
    expect(bsonTypeColor({ $oid: "abc" })).toBe("#6366f1");
  });

  it("returns cyan for $date", () => {
    expect(bsonTypeColor({ $date: "2024-01-01" })).toBe("#0891b2");
  });

  it("returns blue for $numberInt/$numberLong/$numberDouble", () => {
    expect(bsonTypeColor({ $numberInt: "1" })).toBe("#0369a1");
    expect(bsonTypeColor({ $numberLong: "1" })).toBe("#0369a1");
    expect(bsonTypeColor({ $numberDouble: "1" })).toBe("#0369a1");
  });

  it("returns default dark for unknown objects", () => {
    expect(bsonTypeColor({ foo: "bar" })).toBe("#374151");
  });
});

// ── bsonTypeLabel ─────────────────────────────────────────────────────────────

describe("bsonTypeLabel", () => {
  it("returns 'null' for null", () => {
    expect(bsonTypeLabel(null)).toBe("null");
  });

  it("returns array label with length", () => {
    expect(bsonTypeLabel([1, 2, 3])).toBe("Array(3)");
    expect(bsonTypeLabel([])).toBe("Array(0)");
  });

  it("returns 'ObjectId' for $oid", () => {
    expect(bsonTypeLabel({ $oid: "abc" })).toBe("ObjectId");
  });

  it("returns 'Date' for $date", () => {
    expect(bsonTypeLabel({ $date: "2024-01-01" })).toBe("Date");
  });

  it("returns 'Int32' for $numberInt", () => {
    expect(bsonTypeLabel({ $numberInt: "1" })).toBe("Int32");
  });

  it("returns 'Int64' for $numberLong", () => {
    expect(bsonTypeLabel({ $numberLong: "1" })).toBe("Int64");
  });

  it("returns 'Double' for $numberDouble", () => {
    expect(bsonTypeLabel({ $numberDouble: "1.0" })).toBe("Double");
  });

  it("returns 'Decimal128' for $numberDecimal", () => {
    expect(bsonTypeLabel({ $numberDecimal: "3.14" })).toBe("Decimal128");
  });

  it("returns 'Binary' for $binary", () => {
    expect(bsonTypeLabel({ $binary: { base64: "", subType: "00" } })).toBe("Binary");
  });

  it("returns 'Timestamp' for $timestamp", () => {
    expect(bsonTypeLabel({ $timestamp: { t: 1, i: 0 } })).toBe("Timestamp");
  });

  it("returns Object(N) for plain objects", () => {
    expect(bsonTypeLabel({ a: 1, b: 2 })).toBe("Object(2)");
    expect(bsonTypeLabel({})).toBe("Object(0)");
  });

  it("returns typeof for primitive types", () => {
    expect(bsonTypeLabel(42)).toBe("number");
    expect(bsonTypeLabel("hello")).toBe("string");
    expect(bsonTypeLabel(true)).toBe("boolean");
  });
});
