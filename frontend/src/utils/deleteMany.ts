export interface ParsedDeleteMany {
  filter: Record<string, unknown>;
  options: Record<string, unknown>;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseDeleteManyInput(text: string): ParsedDeleteMany {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("empty");
  }

  const parsed = trimmed.startsWith("(") && trimmed.endsWith(")")
    ? JSON.parse(`[${trimmed.slice(1, -1)}]`)
    : JSON.parse(trimmed);

  if (Array.isArray(parsed) && parsed.length >= 1 && parsed.length <= 2 && isObjectRecord(parsed[0])) {
    if (parsed.length === 1) {
      return { filter: parsed[0], options: {} };
    }
    if (isObjectRecord(parsed[1])) {
      return { filter: parsed[0], options: parsed[1] };
    }
  }

  if (isObjectRecord(parsed) && isObjectRecord(parsed.filter)) {
    if (parsed.options === undefined) {
      return { filter: parsed.filter, options: {} };
    }
    if (isObjectRecord(parsed.options)) {
      return { filter: parsed.filter, options: parsed.options };
    }
  }

  throw new Error("invalid-format");
}

export function buildDeleteManyCommand(collection: string, parsed: ParsedDeleteMany): Record<string, unknown> {
  return {
    delete: collection,
    deletes: [
      {
        ...parsed.options,
        q: parsed.filter,
        limit: 0,
      },
    ],
  };
}
