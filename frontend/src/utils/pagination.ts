export function getTotalPages(total: number, limit: number): number {
  const safeTotal = Number.isFinite(total) ? Math.max(0, total) : 0;
  const safeLimit = Number.isFinite(limit) ? Math.max(1, limit) : 1;
  return Math.max(1, Math.ceil(safeTotal / safeLimit));
}

export function parsePageInput(value: string, totalPages: number): number | null {
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed)) return null;
  if (parsed < 1 || parsed > totalPages) return null;
  return parsed;
}

export function hasNextPage(page: number, total: number, limit: number): boolean {
  return page < getTotalPages(total, limit);
}
