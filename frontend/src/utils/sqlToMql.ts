/**
 * SQL → MongoDB Query Language (MQL) translator.
 * Converts a SQL SELECT statement into MongoDB filter, sort, projection, and limit.
 */
import { Parser, type AST, type Select, type Column, type OrderBy } from "node-sql-parser";

export interface MqlQuery {
  filter: Record<string, unknown>;
  sort: Record<string, 1 | -1>;
  projection: Record<string, 1>;
  limit: number | null;
}

export interface SqlParseResult {
  mql: MqlQuery;
  /** Formatted MQL for display */
  preview: {
    filter: string;
    sort: string;
    projection: string;
    limit: string;
  };
  error: null;
}

export interface SqlParseError {
  mql: null;
  preview: null;
  error: string;
}

const parser = new Parser();

export function parseSqlToMql(sql: string): SqlParseResult | SqlParseError {
  const trimmed = sql.trim();
  if (!trimmed) return { mql: null, preview: null, error: "" };

  let ast: AST | AST[];
  try {
    ast = parser.astify(trimmed, { database: "MySQL" });
  } catch (e) {
    return { mql: null, preview: null, error: (e as Error).message };
  }

  const stmt = Array.isArray(ast) ? ast[0] : ast;
  if (!stmt || stmt.type !== "select") {
    return { mql: null, preview: null, error: "Only SELECT statements are supported" };
  }

  const select = stmt as Select;

  try {
    const filter = select.where ? convertWhere(select.where) : {};
    const sort = convertOrderBy(select.orderby ?? null);
    const projection = convertColumns(select.columns);
    const limit = convertLimit(select.limit ?? null);

    const mql: MqlQuery = { filter, sort, projection, limit };
    const preview = {
      filter: Object.keys(filter).length ? JSON.stringify(filter, null, 2) : "",
      sort: Object.keys(sort).length ? JSON.stringify(sort, null, 2) : "",
      projection: Object.keys(projection).length ? JSON.stringify(projection, null, 2) : "",
      limit: limit !== null ? String(limit) : "",
    };

    return { mql, preview, error: null };
  } catch (e) {
    return { mql: null, preview: null, error: (e as Error).message };
  }
}

// ── WHERE clause → MongoDB filter ────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertWhere(node: any): Record<string, unknown> {
  if (!node) return {};

  const type: string = node.type;

  // Logical AND / OR
  if (type === "binary_expr") {
    const op: string = (node.operator as string).toUpperCase();

    if (op === "AND") {
      return { $and: [convertWhere(node.left), convertWhere(node.right)] };
    }
    if (op === "OR") {
      return { $or: [convertWhere(node.left), convertWhere(node.right)] };
    }

    // Comparison operators
    const field = extractField(node.left);
    const value = extractValue(node.right);

    if (op === "=" || op === "IS") return { [field]: { $eq: value } };
    if (op === "!=" || op === "<>" || op === "IS NOT") return { [field]: { $ne: value } };
    if (op === ">") return { [field]: { $gt: value } };
    if (op === ">=") return { [field]: { $gte: value } };
    if (op === "<") return { [field]: { $lt: value } };
    if (op === "<=") return { [field]: { $lte: value } };

    // LIKE → $regex (% → .*, _ → .)
    if (op === "LIKE") {
      const pattern = String(value)
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // escape regex special chars
        .replace(/%/g, ".*")
        .replace(/_/g, ".");
      return { [field]: { $regex: pattern, $options: "i" } };
    }
    if (op === "NOT LIKE") {
      const pattern = String(value)
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/%/g, ".*")
        .replace(/_/g, ".");
      return { [field]: { $not: { $regex: pattern, $options: "i" } } };
    }

    // IN / NOT IN
    if (op === "IN") {
      const vals = extractValueList(node.right);
      return { [field]: { $in: vals } };
    }
    if (op === "NOT IN") {
      const vals = extractValueList(node.right);
      return { [field]: { $nin: vals } };
    }

    // BETWEEN
    if (op === "BETWEEN") {
      const from = extractValue(node.right.left ?? node.right.value?.[0]);
      const to = extractValue(node.right.right ?? node.right.value?.[1]);
      return { [field]: { $gte: from, $lte: to } };
    }
    if (op === "NOT BETWEEN") {
      const from = extractValue(node.right.left ?? node.right.value?.[0]);
      const to = extractValue(node.right.right ?? node.right.value?.[1]);
      return { $or: [{ [field]: { $lt: from } }, { [field]: { $gt: to } }] };
    }

    throw new Error(`Unsupported operator: ${op}`);
  }

  // NOT / unary
  if (type === "unary_expr" && node.operator === "NOT") {
    return { $nor: [convertWhere(node.expr)] };
  }

  throw new Error(`Unsupported WHERE clause type: ${type}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractField(node: any): string {
  if (node.type === "column_ref") {
    const col: string = node.column?.name ?? node.column ?? String(node.column);
    return node.table ? `${node.table}.${col}` : col;
  }
  throw new Error(`Expected column reference, got: ${node.type}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractValue(node: any): unknown {
  if (!node) return null;
  if (node.type === "number") return node.value;
  if (node.type === "string") return node.value;
  if (node.type === "single_quote_string") return node.value;
  if (node.type === "bool") return node.value;
  if (node.type === "null") return null;
  if (node.type === "column_ref") return node.column?.name ?? node.column;
  // Some parsers wrap literals differently
  if (typeof node.value !== "undefined") return node.value;
  throw new Error(`Cannot extract value from node type: ${node.type}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractValueList(node: any): unknown[] {
  if (node.type === "expr_list") return (node.value as unknown[]).map(extractValue);
  if (Array.isArray(node.value)) return (node.value as unknown[]).map(extractValue);
  return [extractValue(node)];
}

// ── ORDER BY → MongoDB sort ───────────────────────────────────────────────────

function convertOrderBy(orderby: OrderBy[] | null): Record<string, 1 | -1> {
  if (!orderby || orderby.length === 0) return {};
  const sort: Record<string, 1 | -1> = {};
  for (const clause of orderby) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const col = (clause.expr as any);
    const colName: string = col.column?.name ?? col.column ?? String(col.column);
    const field: string = col.table ? `${col.table}.${colName}` : colName;
    sort[field] = clause.type?.toUpperCase() === "DESC" ? -1 : 1;
  }
  return sort;
}

// ── SELECT columns → MongoDB projection ──────────────────────────────────────

function convertColumns(columns: Column[] | "*"): Record<string, 1> {
  if (columns === "*" || !Array.isArray(columns)) return {};
  const proj: Record<string, 1> = {};
  for (const col of columns) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((col as any) === "*") continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expr = (col as any).expr ?? col;
    if (expr.type === "column_ref") {
      const colName: string = expr.column?.name ?? expr.column ?? String(expr.column);
      const name: string = expr.table ? `${expr.table}.${colName}` : colName;
      if (name !== "*") proj[name] = 1;
    }
  }
  return proj;
}

// ── LIMIT → number ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertLimit(limit: any): number | null {
  if (!limit) return null;
  // node-sql-parser: limit.value is array of {type, value} for LIMIT [offset,] n
  if (Array.isArray(limit.value)) {
    const last = limit.value[limit.value.length - 1];
    const n = Number(last?.value ?? last);
    return isNaN(n) ? null : n;
  }
  const n = Number(limit.value ?? limit);
  return isNaN(n) ? null : n;
}
