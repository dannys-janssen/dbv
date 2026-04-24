use axum::{
    Json,
    body::{Body, Bytes},
    extract::{Path, Query, State},
    http::header,
    response::Response,
};
use bson::Document;
use futures::TryStreamExt;
use serde::Deserialize;
use serde_json::Value;

use crate::{
    auth::rbac::{ReadAccess, WriteAccess},
    errors::AppError,
    state::AppState,
};

/// Export all documents in a collection as a JSON array (newline-delimited).
pub async fn export_collection(
    _claims: ReadAccess,
    State(state): State<AppState>,
    Path((db, collection)): Path<(String, String)>,
) -> Result<Response, AppError> {
    let coll: mongodb::Collection<Document> = state.db.read().await.collection(&db, &collection);
    let mut cursor = coll.find(bson::doc! {}).await?;
    let mut docs: Vec<Value> = Vec::new();
    while let Some(doc) = cursor.try_next().await? {
        docs.push(serde_json::to_value(doc).unwrap_or(Value::Null));
    }

    let body =
        serde_json::to_string_pretty(&docs).map_err(|e| AppError::Internal(e.to_string()))?;

    let filename = format!("{collection}.json");
    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "application/json")
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{filename}\""),
        )
        .body(Body::from(body))
        .unwrap())
}

/// Export all documents in a collection as a concatenated BSON binary stream
/// (compatible with the `mongodump` `.bson` file format).
pub async fn export_collection_bson(
    _claims: ReadAccess,
    State(state): State<AppState>,
    Path((db, collection)): Path<(String, String)>,
) -> Result<Response, AppError> {
    let coll: mongodb::Collection<Document> = state.db.read().await.collection(&db, &collection);
    let mut cursor = coll.find(bson::doc! {}).await?;
    let mut buf: Vec<u8> = Vec::new();
    while let Some(doc) = cursor.try_next().await? {
        let bytes = bson::to_vec(&doc).map_err(AppError::BsonSer)?;
        buf.extend_from_slice(&bytes);
    }

    let filename = format!("{collection}.bson");
    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{filename}\""),
        )
        .body(Body::from(buf))
        .unwrap())
}

/// Import documents into a collection from a JSON array body.
#[derive(Deserialize)]
pub struct ImportBody {
    /// If true, drop the collection before importing.
    #[serde(default)]
    pub replace: bool,
    pub documents: Vec<Value>,
}

pub async fn import_collection(
    _claims: WriteAccess,
    State(state): State<AppState>,
    Path((db, collection)): Path<(String, String)>,
    Json(body): Json<ImportBody>,
) -> Result<Json<Value>, AppError> {
    let coll: mongodb::Collection<Document> = state
        .db
        .read()
        .await
        .collection::<Document>(&db, &collection);

    if body.replace {
        coll.drop().await?;
    }

    let documents: Vec<Document> = body
        .documents
        .iter()
        .map(|v| bson::to_document(v).map_err(AppError::BsonSer))
        .collect::<Result<_, _>>()?;

    if documents.is_empty() {
        return Ok(Json(serde_json::json!({ "inserted": 0 })));
    }

    let result = coll.insert_many(documents).await?;
    Ok(Json(serde_json::json!({
        "inserted": result.inserted_ids.len()
    })))
}

/// Query parameters for BSON import.
#[derive(Deserialize)]
pub struct BsonImportParams {
    /// If true, drop the collection before importing.
    #[serde(default)]
    pub replace: bool,
}

/// Import documents from a concatenated BSON binary body
/// (compatible with the `mongodump` `.bson` file format).
/// Pass `?replace=true` to drop the collection before importing.
pub async fn import_collection_bson(
    _claims: WriteAccess,
    State(state): State<AppState>,
    Path((db, collection)): Path<(String, String)>,
    Query(params): Query<BsonImportParams>,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let coll: mongodb::Collection<Document> = state
        .db
        .read()
        .await
        .collection::<Document>(&db, &collection);

    let documents = parse_bson_bytes(&body)?;

    if params.replace {
        coll.drop().await?;
    }

    if documents.is_empty() {
        return Ok(Json(serde_json::json!({ "inserted": 0 })));
    }

    let result = coll.insert_many(documents).await?;
    Ok(Json(serde_json::json!({
        "inserted": result.inserted_ids.len()
    })))
}

/// Parse a concatenated BSON binary buffer into a list of documents.
/// This format is compatible with `mongodump` `.bson` files.
pub fn parse_bson_bytes(data: &[u8]) -> Result<Vec<Document>, AppError> {
    let mut documents = Vec::new();
    let mut cursor = std::io::Cursor::new(data);
    let total = data.len() as u64;
    while cursor.position() < total {
        let doc = Document::from_reader(&mut cursor).map_err(AppError::BsonDe)?;
        documents.push(doc);
    }
    Ok(documents)
}

#[cfg(test)]
mod tests {
    use super::*;
    use bson::doc;

    #[test]
    fn round_trip_single_document() {
        let original = doc! { "name": "Alice", "age": 30 };
        let bytes = bson::to_vec(&original).expect("serialize");
        let docs = parse_bson_bytes(&bytes).expect("parse");
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].get_str("name").unwrap(), "Alice");
        assert_eq!(docs[0].get_i32("age").unwrap(), 30);
    }

    #[test]
    fn round_trip_multiple_documents() {
        let doc1 = doc! { "x": 1 };
        let doc2 = doc! { "x": 2 };
        let doc3 = doc! { "x": 3 };
        let mut buf = Vec::new();
        for d in [&doc1, &doc2, &doc3] {
            buf.extend_from_slice(&bson::to_vec(d).expect("serialize"));
        }
        let docs = parse_bson_bytes(&buf).expect("parse");
        assert_eq!(docs.len(), 3);
        assert_eq!(docs[0].get_i32("x").unwrap(), 1);
        assert_eq!(docs[1].get_i32("x").unwrap(), 2);
        assert_eq!(docs[2].get_i32("x").unwrap(), 3);
    }

    #[test]
    fn empty_buffer_returns_empty_vec() {
        let docs = parse_bson_bytes(&[]).expect("parse empty");
        assert!(docs.is_empty());
    }

    #[test]
    fn invalid_bson_returns_error() {
        let garbage = b"\x00\x00\x00\x00garbage";
        let result = parse_bson_bytes(garbage);
        assert!(result.is_err());
    }

    #[test]
    fn round_trip_nested_document() {
        let original = doc! { "meta": { "tag": "test" }, "values": [1, 2, 3] };
        let bytes = bson::to_vec(&original).expect("serialize");
        let docs = parse_bson_bytes(&bytes).expect("parse");
        assert_eq!(docs.len(), 1);
        let meta = docs[0].get_document("meta").unwrap();
        assert_eq!(meta.get_str("tag").unwrap(), "test");
    }
}
