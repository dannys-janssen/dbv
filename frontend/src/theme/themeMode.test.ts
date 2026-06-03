import { describe, expect, it } from "vitest";
import {
  normalizeThemeMode,
  readStoredThemeMode,
  THEME_MODE_STORAGE_KEY,
  writeStoredThemeMode,
} from "./themeMode";

describe("themeMode", () => {
  it("normalizes unknown values to light", () => {
    expect(normalizeThemeMode("unknown")).toBe("light");
    expect(normalizeThemeMode(null)).toBe("light");
  });

  it("reads a persisted dark mode", () => {
    const storage = {
      getItem: (key: string) => (key === THEME_MODE_STORAGE_KEY ? "dark" : null),
      setItem: () => {},
    };

    expect(readStoredThemeMode(storage)).toBe("dark");
  });

  it("writes selected mode to storage", () => {
    let stored: string | null = null;
    const storage = {
      getItem: () => stored,
      setItem: (key: string, value: string) => {
        if (key === THEME_MODE_STORAGE_KEY) {
          stored = value;
        }
      },
    };

    writeStoredThemeMode("dark", storage);
    expect(stored).toBe("dark");
    expect(readStoredThemeMode(storage)).toBe("dark");
  });
});
