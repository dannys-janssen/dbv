import { describe, expect, it } from "vitest";
import { getTotalPages, hasNextPage, parsePageInput } from "./pagination";

describe("getTotalPages", () => {
  it("returns at least one page", () => {
    expect(getTotalPages(0, 20)).toBe(1);
  });

  it("rounds up partial pages", () => {
    expect(getTotalPages(41, 20)).toBe(3);
  });
});

describe("parsePageInput", () => {
  it("accepts integers within range", () => {
    expect(parsePageInput("3", 5)).toBe(3);
  });

  it("rejects empty, non-integer, and out-of-range values", () => {
    expect(parsePageInput("", 5)).toBeNull();
    expect(parsePageInput("2.5", 5)).toBeNull();
    expect(parsePageInput("0", 5)).toBeNull();
    expect(parsePageInput("6", 5)).toBeNull();
  });
});

describe("hasNextPage", () => {
  it("uses the known total to determine the last page", () => {
    expect(hasNextPage(1, 40, 20)).toBe(true);
    expect(hasNextPage(2, 40, 20)).toBe(false);
  });
});
