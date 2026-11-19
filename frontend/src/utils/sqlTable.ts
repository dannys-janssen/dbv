/** Helpers for the read-only SQL table browser. */

/** Render a single SQL cell value for the grid. */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Parse a JSON object text field.
 * Returns `undefined` for blank input and `null` when the input is not a JSON object.
 */
export function parseJsonField(raw: string): Record<string, unknown> | null | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** Column order for a page of rows: server order first, then any extra keys. */
export function columnsForRows(
  serverColumns: string[] | undefined,
  rows: Record<string, unknown>[]
): string[] {
  const cols = [...(serverColumns ?? [])];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!cols.includes(key)) cols.push(key);
    }
  }
  return cols;
}

/** Format a byte count for the stats table. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
