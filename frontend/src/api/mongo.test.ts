import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exportCollectionBson, importCollectionBson } from "./mongo";

// Mock localStorage
const localStorageMock = (() => {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  };
})();

beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
  localStorageMock.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("exportCollectionBson", () => {
  it("calls the correct BSON export URL", async () => {
    const mockBlob = new Blob([new Uint8Array([1, 2, 3])]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(mockBlob),
    });
    vi.stubGlobal("fetch", fetchMock);

    const createObjectURLMock = vi.fn().mockReturnValue("blob:mock");
    const revokeObjectURLMock = vi.fn();
    const appendChildMock = vi.fn();
    const removeChildMock = vi.fn();
    const clickMock = vi.fn();

    const anchor = { href: "", download: "", click: clickMock } as unknown as HTMLAnchorElement;
    vi.stubGlobal("URL", { createObjectURL: createObjectURLMock, revokeObjectURL: revokeObjectURLMock });
    vi.stubGlobal("document", {
      createElement: vi.fn().mockReturnValue(anchor),
      body: { appendChild: appendChildMock, removeChild: removeChildMock },
    });

    await exportCollectionBson("mydb", "mycol");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/databases/mydb/collections/mycol/export/bson",
      expect.objectContaining({ headers: {} })
    );
    expect(anchor.download).toBe("mycol.bson");
    expect(clickMock).toHaveBeenCalled();
    expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:mock");
  });

  it("includes the Authorization header when token is present", async () => {
    localStorageMock.setItem("access_token", "test-jwt");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob()),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", { createObjectURL: vi.fn().mockReturnValue("blob:x"), revokeObjectURL: vi.fn() });
    const anchor = { href: "", download: "", click: vi.fn() } as unknown as HTMLAnchorElement;
    vi.stubGlobal("document", { createElement: vi.fn().mockReturnValue(anchor) });

    await exportCollectionBson("db", "col");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: { Authorization: "Bearer test-jwt" } })
    );
  });

  it("throws when the server returns an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "not found" }),
    }));

    await expect(exportCollectionBson("db", "col")).rejects.toThrow("not found");
  });
});

describe("importCollectionBson", () => {
  it("POSTs binary data to the correct URL without replace", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ inserted: 5 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const buffer = new ArrayBuffer(8);
    const result = await importCollectionBson("mydb", "mycol", buffer, false);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/databases/mydb/collections/mycol/import/bson",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/octet-stream" }),
        body: buffer,
      })
    );
    expect(result).toEqual({ inserted: 5 });
  });

  it("appends ?replace=true when replace is true", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ inserted: 3 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await importCollectionBson("db", "col", new ArrayBuffer(4), true);

    const calledUrl = (fetchMock.mock.calls[0] as [string, RequestInit])[0];
    expect(calledUrl).toContain("?replace=true");
  });

  it("throws when the server returns an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "unauthorized" }),
    }));

    await expect(importCollectionBson("db", "col", new ArrayBuffer(0), false)).rejects.toThrow("unauthorized");
  });

  it("includes the Authorization header when token is present", async () => {
    localStorageMock.setItem("access_token", "my-token");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ inserted: 1 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await importCollectionBson("db", "col", new ArrayBuffer(0), false);

    const calledOpts = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
    expect((calledOpts.headers as Record<string, string>)["Authorization"]).toBe("Bearer my-token");
  });
});
