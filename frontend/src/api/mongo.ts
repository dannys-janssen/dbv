import api from "./client";

export interface DatabaseList {
  databases: string[];
}

export interface CollectionList {
  collections: string[];
}

export interface DocumentPage {
  total: number;
  page: number;
  limit: number;
  documents: Record<string, unknown>[];
}

export interface AggregateResult {
  results: Record<string, unknown>[];
}

export const createDatabase = (db: string, collection: string) =>
  api.post(`/databases/${db}`, { collection }).then((r) => r.data);

export const dropDatabase = (db: string) =>
  api.delete(`/databases/${db}`).then((r) => r.data);

export const createCollection = (db: string, name: string) =>
  api.post(`/databases/${db}/collections`, { name }).then((r) => r.data);

export const dropCollection = (db: string, collection: string) =>
  api.delete(`/databases/${db}/collections/${collection}`).then((r) => r.data);

export const getDatabases = () =>
  api.get<DatabaseList>("/databases").then((r) => r.data);

export const getCollections = (db: string) =>
  api.get<CollectionList>(`/databases/${db}/collections`).then((r) => r.data);

export const getDocuments = (
  db: string,
  collection: string,
  page = 1,
  limit = 20,
  filter?: string,
  sort?: string,
  projection?: string
) =>
  api
    .get<DocumentPage>(`/databases/${db}/collections/${collection}/documents`, {
      params: { page, limit, filter, sort, projection },
    })
    .then((r) => r.data);

export const getDocument = (db: string, collection: string, id: string) =>
  api
    .get<Record<string, unknown>>(
      `/databases/${db}/collections/${collection}/documents/${id}`
    )
    .then((r) => r.data);

export const createDocument = (
  db: string,
  collection: string,
  body: Record<string, unknown>
) =>
  api
    .post(`/databases/${db}/collections/${collection}/documents`, body)
    .then((r) => r.data);

export const updateDocument = (
  db: string,
  collection: string,
  id: string,
  body: Record<string, unknown>
) =>
  api
    .put(`/databases/${db}/collections/${collection}/documents/${id}`, body)
    .then((r) => r.data);

export const deleteDocument = (db: string, collection: string, id: string) =>
  api
    .delete(`/databases/${db}/collections/${collection}/documents/${id}`)
    .then((r) => r.data);

export const bulkDeleteDocuments = (db: string, collection: string, ids: string[]) =>
  api
    .delete(`/databases/${db}/collections/${collection}/documents`, { data: { ids } })
    .then((r) => r.data);

export const aggregate = (
  db: string,
  collection: string,
  pipeline: unknown[]
) =>
  api
    .post<AggregateResult>(
      `/databases/${db}/collections/${collection}/aggregate`,
      { pipeline }
    )
    .then((r) => r.data);

export const exportCollection = async (db: string, collection: string): Promise<void> => {
  const token = localStorage.getItem("access_token");
  const url = `/api/databases/${db}/collections/${collection}/export`;
  const resp = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: "Export failed" }));
    throw new Error((err as { error?: string }).error ?? "Export failed");
  }
  const blob = await resp.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = `${collection}.json`;
  a.click();
  URL.revokeObjectURL(objectUrl);
};

export interface SchemaField {
  path: string;
  types: string[];
  nullable: boolean;
  occurrences: number;
  coverage: number;
}

export interface CollectionSchema {
  sampled_documents: number;
  fields: SchemaField[];
}

export const getSchema = (db: string, collection: string) =>
  api
    .get<CollectionSchema>(
      `/databases/${db}/collections/${collection}/schema`
    )
    .then((r) => r.data);

export const importCollection = (
  db: string,
  collection: string,
  documents: unknown[],
  replace = false
) =>
  api
    .post(`/databases/${db}/collections/${collection}/import`, {
      documents,
      replace,
    })
    .then((r) => r.data);

// ── Index management ──────────────────────────────────────────────────────────

export interface IndexInfo {
  name: string;
  keys: Record<string, number>;
  unique: boolean;
  sparse: boolean;
  ttl?: number;
}

export interface IndexList {
  indexes: IndexInfo[];
}

export interface IndexKey {
  field: string;
  direction: 1 | -1;
}

export const listIndexes = (db: string, collection: string) =>
  api
    .get<IndexList>(`/databases/${db}/collections/${collection}/indexes`)
    .then((r) => r.data);

export const createIndex = (
  db: string,
  collection: string,
  keys: Record<string, 1 | -1>,
  options?: { name?: string; unique?: boolean; sparse?: boolean; ttl?: number; background?: boolean }
) =>
  api
    .post(`/databases/${db}/collections/${collection}/indexes`, { keys, ...options })
    .then((r) => r.data);

export const dropIndex = (db: string, collection: string, name: string) =>
  api
    .delete(`/databases/${db}/collections/${collection}/indexes/${name}`)
    .then((r) => r.data);

// ── Stats ──────────────────────────────────────────────────────────────────────

export const getDatabaseStats = (db: string) =>
  api.get<Record<string, unknown>>(`/databases/${db}/stats`).then((r) => r.data);

export const getCollectionStats = (db: string, collection: string) =>
  api
    .get<Record<string, unknown>>(`/databases/${db}/collections/${collection}/stats`)
    .then((r) => r.data);

// ── Connection management ─────────────────────────────────────────────────────

export interface ConnectionInfo {
  uri: string;
  default_db: string;
  status: "ok" | "error";
  error?: string;
  tls_ca_file?: string;
  tls_cert_key_file?: string;
  tls_allow_invalid_certs?: boolean;
}

export const getConnection = (): Promise<ConnectionInfo> =>
  api.get<ConnectionInfo>("/connection").then((r) => r.data);

export interface SetConnectionParams {
  uri: string;
  default_db?: string;
  tls_ca_file?: string;
  tls_cert_key_file?: string;
  tls_allow_invalid_certs?: boolean;
}

export const setConnection = (params: SetConnectionParams): Promise<ConnectionInfo> =>
  api.post<ConnectionInfo>("/connection", params).then((r) => r.data);

export const reconnectMongo = (): Promise<ConnectionInfo> =>
  api.post<ConnectionInfo>("/connection/reconnect").then((r) => r.data);

// ── Run command ────────────────────────────────────────────────────────────────

export const runDbCommand = (
  db: string,
  command: Record<string, unknown>,
  admin = false
) =>
  api
    .post<{ result: Record<string, unknown> }>(`/databases/${db}/run_command`, { command, admin })
    .then((r) => r.data.result);
