import { describe, it, expect } from "vitest";
import { parseSqlToMql } from "./sqlToMql";

// ── Empty / invalid input ─────────────────────────────────────────────────────

describe("parseSqlToMql – empty / invalid input", () => {
  it("returns no error for empty string", () => {
    const r = parseSqlToMql("");
    expect(r.error).toBe("");
    expect(r.mql).toBeNull();
  });

  it("returns no error for whitespace-only string", () => {
    const r = parseSqlToMql("   ");
    expect(r.error).toBe("");
    expect(r.mql).toBeNull();
  });

  it("returns error for non-SELECT statement", () => {
    const r = parseSqlToMql("INSERT INTO foo VALUES (1)");
    expect(r.error).toBeTruthy();
    expect(r.mql).toBeNull();
  });

  it("returns error for completely invalid SQL", () => {
    const r = parseSqlToMql("this is not sql at all !!!");
    expect(r.error).toBeTruthy();
    expect(r.mql).toBeNull();
  });
});

// ── SELECT columns → projection ───────────────────────────────────────────────

describe("parseSqlToMql – SELECT projection", () => {
  it("SELECT * produces empty projection", () => {
    const r = parseSqlToMql("SELECT * FROM users");
    expect(r.error).toBeNull();
    expect(r.mql!.projection).toEqual({});
  });

  it("SELECT named columns produces projection", () => {
    const r = parseSqlToMql("SELECT name, age FROM users");
    expect(r.error).toBeNull();
    expect(r.mql!.projection).toEqual({ name: 1, age: 1 });
  });

  it("SELECT single column", () => {
    const r = parseSqlToMql("SELECT email FROM accounts");
    expect(r.error).toBeNull();
    expect(r.mql!.projection).toEqual({ email: 1 });
  });
});

// ── WHERE clause → filter ─────────────────────────────────────────────────────

describe("parseSqlToMql – WHERE equality", () => {
  it("= maps to $eq", () => {
    const r = parseSqlToMql("SELECT * FROM t WHERE age = 30");
    expect(r.error).toBeNull();
    expect(r.mql!.filter).toEqual({ age: { $eq: 30 } });
  });

  it("string equality", () => {
    const r = parseSqlToMql("SELECT * FROM t WHERE name = 'Alice'");
    expect(r.error).toBeNull();
    expect(r.mql!.filter).toEqual({ name: { $eq: "Alice" } });
  });

  it("!= maps to $ne", () => {
    const r = parseSqlToMql("SELECT * FROM t WHERE status != 'inactive'");
    expect(r.error).toBeNull();
    expect(r.mql!.filter).toEqual({ status: { $ne: "inactive" } });
  });

  it("<> maps to $ne", () => {
    const r = parseSqlToMql("SELECT * FROM t WHERE status <> 'inactive'");
    expect(r.error).toBeNull();
    expect(r.mql!.filter).toEqual({ status: { $ne: "inactive" } });
  });
});

describe("parseSqlToMql – WHERE comparisons", () => {
  it("> maps to $gt", () => {
    const r = parseSqlToMql("SELECT * FROM t WHERE score > 90");
    expect(r.error).toBeNull();
    expect(r.mql!.filter).toEqual({ score: { $gt: 90 } });
  });

  it(">= maps to $gte", () => {
    const r = parseSqlToMql("SELECT * FROM t WHERE score >= 90");
    expect(r.error).toBeNull();
    expect(r.mql!.filter).toEqual({ score: { $gte: 90 } });
  });

  it("< maps to $lt", () => {
    const r = parseSqlToMql("SELECT * FROM t WHERE age < 18");
    expect(r.error).toBeNull();
    expect(r.mql!.filter).toEqual({ age: { $lt: 18 } });
  });

  it("<= maps to $lte", () => {
    const r = parseSqlToMql("SELECT * FROM t WHERE age <= 65");
    expect(r.error).toBeNull();
    expect(r.mql!.filter).toEqual({ age: { $lte: 65 } });
  });
});

describe("parseSqlToMql – WHERE logical operators", () => {
  it("AND maps to $and", () => {
    const r = parseSqlToMql("SELECT * FROM t WHERE age > 18 AND active = 1");
    expect(r.error).toBeNull();
    expect(r.mql!.filter).toEqual({
      $and: [{ age: { $gt: 18 } }, { active: { $eq: 1 } }],
    });
  });

  it("OR maps to $or", () => {
    const r = parseSqlToMql("SELECT * FROM t WHERE role = 'admin' OR role = 'mod'");
    expect(r.error).toBeNull();
    expect(r.mql!.filter).toEqual({
      $or: [{ role: { $eq: "admin" } }, { role: { $eq: "mod" } }],
    });
  });

  it("NOT maps to $nor", () => {
    const r = parseSqlToMql("SELECT * FROM t WHERE NOT deleted = 1");
    expect(r.error).toBeNull();
    expect(r.mql!.filter).toEqual({ $nor: [{ deleted: { $eq: 1 } }] });
  });
});

describe("parseSqlToMql – WHERE LIKE / NOT LIKE", () => {
  it("LIKE with % wildcard maps to $regex with .*", () => {
    const r = parseSqlToMql("SELECT * FROM t WHERE name LIKE 'Alice%'");
    expect(r.error).toBeNull();
    const filter = r.mql!.filter as Record<string, { $regex: string; $options: string }>;
    expect(filter.name.$regex).toBe("Alice.*");
    expect(filter.name.$options).toBe("i");
  });

  it("LIKE with _ wildcard maps to $regex with .", () => {
    const r = parseSqlToMql("SELECT * FROM t WHERE code LIKE 'A_C'");
    expect(r.error).toBeNull();
    const filter = r.mql!.filter as Record<string, { $regex: string }>;
    expect(filter.code.$regex).toBe("A.C");
  });

  it("NOT LIKE maps to $not $regex", () => {
    const r = parseSqlToMql("SELECT * FROM t WHERE name NOT LIKE '%test%'");
    expect(r.error).toBeNull();
    const filter = r.mql!.filter as Record<string, { $not: { $regex: string } }>;
    expect(filter.name.$not.$regex).toBe(".*test.*");
  });
});

describe("parseSqlToMql – WHERE IN / NOT IN", () => {
  it("IN maps to $in", () => {
    const r = parseSqlToMql("SELECT * FROM t WHERE status IN ('active', 'pending')");
    expect(r.error).toBeNull();
    expect(r.mql!.filter).toEqual({ status: { $in: ["active", "pending"] } });
  });

  it("NOT IN maps to $nin", () => {
    const r = parseSqlToMql("SELECT * FROM t WHERE status NOT IN ('banned', 'deleted')");
    expect(r.error).toBeNull();
    expect(r.mql!.filter).toEqual({ status: { $nin: ["banned", "deleted"] } });
  });

  it("IN with numbers", () => {
    const r = parseSqlToMql("SELECT * FROM t WHERE level IN (1, 2, 3)");
    expect(r.error).toBeNull();
    expect(r.mql!.filter).toEqual({ level: { $in: [1, 2, 3] } });
  });
});

describe("parseSqlToMql – WHERE BETWEEN", () => {
  it("BETWEEN maps to $gte/$lte range", () => {
    const r = parseSqlToMql("SELECT * FROM t WHERE age BETWEEN 18 AND 65");
    expect(r.error).toBeNull();
    expect(r.mql!.filter).toEqual({ age: { $gte: 18, $lte: 65 } });
  });

  it("NOT BETWEEN maps to $or with $lt/$gt", () => {
    const r = parseSqlToMql("SELECT * FROM t WHERE age NOT BETWEEN 18 AND 65");
    expect(r.error).toBeNull();
    expect(r.mql!.filter).toEqual({
      $or: [{ age: { $lt: 18 } }, { age: { $gt: 65 } }],
    });
  });
});

describe("parseSqlToMql – WHERE IS NULL / IS NOT NULL", () => {
  it("IS NULL maps to $eq null", () => {
    const r = parseSqlToMql("SELECT * FROM t WHERE email IS NULL");
    expect(r.error).toBeNull();
    expect(r.mql!.filter).toEqual({ email: { $eq: null } });
  });

  it("IS NOT NULL maps to $ne null", () => {
    const r = parseSqlToMql("SELECT * FROM t WHERE email IS NOT NULL");
    expect(r.error).toBeNull();
    expect(r.mql!.filter).toEqual({ email: { $ne: null } });
  });
});

// ── ORDER BY → sort ───────────────────────────────────────────────────────────

describe("parseSqlToMql – ORDER BY", () => {
  it("ORDER BY col ASC maps to sort 1", () => {
    const r = parseSqlToMql("SELECT * FROM t ORDER BY name ASC");
    expect(r.error).toBeNull();
    expect(r.mql!.sort).toEqual({ name: 1 });
  });

  it("ORDER BY col DESC maps to sort -1", () => {
    const r = parseSqlToMql("SELECT * FROM t ORDER BY created DESC");
    expect(r.error).toBeNull();
    expect(r.mql!.sort).toEqual({ created: -1 });
  });

  it("ORDER BY multiple columns", () => {
    const r = parseSqlToMql("SELECT * FROM t ORDER BY age ASC, name DESC");
    expect(r.error).toBeNull();
    expect(r.mql!.sort).toEqual({ age: 1, name: -1 });
  });

  it("no ORDER BY produces empty sort", () => {
    const r = parseSqlToMql("SELECT * FROM t");
    expect(r.error).toBeNull();
    expect(r.mql!.sort).toEqual({});
  });
});

// ── LIMIT ─────────────────────────────────────────────────────────────────────

describe("parseSqlToMql – LIMIT", () => {
  it("LIMIT n produces numeric limit", () => {
    const r = parseSqlToMql("SELECT * FROM t LIMIT 10");
    expect(r.error).toBeNull();
    expect(r.mql!.limit).toBe(10);
  });

  it("no LIMIT produces null", () => {
    const r = parseSqlToMql("SELECT * FROM t");
    expect(r.error).toBeNull();
    expect(r.mql!.limit).toBeNull();
  });
});

// ── Combined query ────────────────────────────────────────────────────────────

describe("parseSqlToMql – combined SELECT/WHERE/ORDER BY/LIMIT", () => {
  it("full query translates all parts", () => {
    const r = parseSqlToMql(
      "SELECT name, email FROM users WHERE age >= 18 AND active = 1 ORDER BY name ASC LIMIT 25"
    );
    expect(r.error).toBeNull();
    const { filter, sort, projection, limit } = r.mql!;
    expect(projection).toEqual({ name: 1, email: 1 });
    expect(filter).toEqual({
      $and: [{ age: { $gte: 18 } }, { active: { $eq: 1 } }],
    });
    expect(sort).toEqual({ name: 1 });
    expect(limit).toBe(25);
  });
});

// ── preview ───────────────────────────────────────────────────────────────────

describe("parseSqlToMql – preview", () => {
  it("preview is populated when results exist", () => {
    const r = parseSqlToMql("SELECT name FROM t WHERE age > 5 ORDER BY age DESC LIMIT 3");
    expect(r.error).toBeNull();
    expect(r.preview!.filter).toContain("$gt");
    expect(r.preview!.projection).toContain("name");
    expect(r.preview!.sort).toContain("-1");
    expect(r.preview!.limit).toBe("3");
  });

  it("preview fields are empty strings when no data", () => {
    const r = parseSqlToMql("SELECT * FROM t");
    expect(r.error).toBeNull();
    expect(r.preview!.filter).toBe("");
    expect(r.preview!.sort).toBe("");
    expect(r.preview!.projection).toBe("");
    expect(r.preview!.limit).toBe("");
  });
});
