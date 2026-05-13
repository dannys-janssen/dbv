export interface ParsedUpdateMany {
  filter: Record<string, unknown>;
  update: Record<string, unknown>;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseUpdateManyInput(text: string): ParsedUpdateMany {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("empty");
  }

  const parsed = trimmed.startsWith("(") && trimmed.endsWith(")")
    ? JSON.parse(`[${trimmed.slice(1, -1)}]`)
    : JSON.parse(trimmed);

  if (Array.isArray(parsed) && parsed.length === 2 && isObjectRecord(parsed[0]) && isObjectRecord(parsed[1])) {
    return { filter: parsed[0], update: parsed[1] };
  }

  if (isObjectRecord(parsed) && isObjectRecord(parsed.filter) && isObjectRecord(parsed.update)) {
    return { filter: parsed.filter, update: parsed.update };
  }

  throw new Error("invalid-format");
}

export function buildUpdateManyCommand(collection: string, parsed: ParsedUpdateMany): Record<string, unknown> {
  return {
    update: collection,
    updates: [
      {
        q: parsed.filter,
        u: parsed.update,
        multi: true,
      },
    ],
  };
}
