import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exportCollection, exportCollectionBson, importCollectionBson } from "./mongo";

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

// Helper to set up a successful fetch mock with a download anchor
function setupExportMocks(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("URL", { createObjectURL: vi.fn().mockReturnValue("blob:x"), revokeObjectURL: vi.fn() });
  const anchor = { href: "", download: "", click: vi.fn() } as unknown as HTMLAnchorElement;
  vi.stubGlobal("document", { createElement: vi.fn().mockReturnValue(anchor) });
  return anchor;
}

describe("exportCollection", () => {
  it("calls the JSON export URL without filter when none provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob()) });
    setupExportMocks(fetchMock);

    await exportCollection("mydb", "mycol");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/databases/mydb/collections/mycol/export",
      expect.any(Object)
    );
  });

  it("appends ?filter= when filter is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob()) });
    setupExportMocks(fetchMock);
    const filter = '{"status":"active"}';

    await exportCollection("db", "col", filter);

    const calledUrl = (fetchMock.mock.calls[0] as [string, RequestInit])[0];
    expect(calledUrl).toContain("filter=");
    expect(calledUrl).toContain(encodeURIComponent(filter));
  });
});

describe("exportCollectionBson", () => {
  it("calls the correct BSON export URL", async () => {
    const mockBlob = new Blob([new Uint8Array([1, 2, 3])]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(mockBlob),
    });
    const anchor = setupExportMocks(fetchMock);

    await exportCollectionBson("mydb", "mycol");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/databases/mydb/collections/mycol/export/bson",
      expect.objectContaining({ headers: {} })
    );
    expect(anchor.download).toBe("mycol.bson");
    expect((anchor as { click: ReturnType<typeof vi.fn> }).click).toHaveBeenCalled();
  });

  it("appends ?filter= when filter is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob()) });
    setupExportMocks(fetchMock);
    const filter = '{"status":"active"}';

    await exportCollectionBson("db", "col", filter);

    const calledUrl = (fetchMock.mock.calls[0] as [string, RequestInit])[0];
    expect(calledUrl).toContain("filter=");
    expect(calledUrl).toContain(encodeURIComponent(filter));
  });

  it("includes the Authorization header when token is present", async () => {
    localStorageMock.setItem("access_token", "test-jwt");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob()),
    });
    setupExportMocks(fetchMock);

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
