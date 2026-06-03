export const THEME_MODE_STORAGE_KEY = "dbv-theme-mode";

export type ThemeMode = "light" | "dark";

type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === "dark" ? "dark" : "light";
}

function getDefaultStorage(): ThemeStorage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function readStoredThemeMode(storage: ThemeStorage | null = getDefaultStorage()): ThemeMode {
  if (!storage) return "light";
  try {
    return normalizeThemeMode(storage.getItem(THEME_MODE_STORAGE_KEY));
  } catch {
    return "light";
  }
}

export function writeStoredThemeMode(
  mode: ThemeMode,
  storage: ThemeStorage | null = getDefaultStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(THEME_MODE_STORAGE_KEY, mode);
  } catch {
    // Ignore storage write failures (e.g. private mode / blocked storage).
  }
}
