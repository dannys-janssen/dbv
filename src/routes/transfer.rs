use axum::{
    body::Body,
    extract::{Path, State},
    http::header,
    response::Response,
    Json,
};
use bson::Document;
use futures::TryStreamExt;
use serde::Deserialize;
use serde_json::Value;

use crate::{auth::rbac::{ReadAccess, WriteAccess}, errors::AppError, state::AppState};

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

    let body = serde_json::to_string_pretty(&docs)
        .map_err(|e| AppError::Internal(e.to_string()))?;

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
    let coll: mongodb::Collection<Document> = state.db.read().await.collection::<Document>(&db, &collection);

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
