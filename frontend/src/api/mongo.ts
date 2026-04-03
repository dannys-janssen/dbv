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
  sort?: string
) =>
  api
    .get<DocumentPage>(`/databases/${db}/collections/${collection}/documents`, {
      params: { page, limit, filter, sort },
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

export const exportCollection = (db: string, collection: string) => {
  const token = localStorage.getItem("access_token");
  const url = `/api/databases/${db}/collections/${collection}/export`;
  const a = document.createElement("a");
  a.href = token
    ? `${url}?token=${encodeURIComponent(token)}`
    : url;
  a.download = `${collection}.json`;
  a.click();
};

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
