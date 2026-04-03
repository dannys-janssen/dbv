use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use bson::{doc, Document};
use futures::TryStreamExt;
use mongodb::options::FindOptions;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{auth::rbac::{ReadAccess, WriteAccess}, errors::AppError, state::AppState};

const SYSTEM_DATABASES: &[&str] = &["admin", "config", "local"];

#[derive(Debug, Deserialize)]
pub struct PaginationParams {
    #[serde(default = "default_page")]
    pub page: u64,
    #[serde(default = "default_limit")]
    pub limit: i64,
    pub filter: Option<String>,
    pub sort: Option<String>,
}

fn default_page() -> u64 {
    1
}
fn default_limit() -> i64 {
    20
}

pub async fn list_databases(
    _claims: ReadAccess,
    State(state): State<AppState>,
) -> Result<Json<Value>, AppError> {
    let dbs = state.db.list_databases().await?;
    Ok(Json(json!({ "databases": dbs })))
}

#[derive(Debug, Deserialize)]
pub struct CreateDatabaseBody {
    pub collection: String,
}

pub async fn create_database(
    _claims: WriteAccess,
    State(state): State<AppState>,
    Path(db): Path<String>,
    Json(body): Json<CreateDatabaseBody>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    if SYSTEM_DATABASES.contains(&db.as_str()) {
        return Err(AppError::BadRequest(format!("Cannot create system database '{db}'")));
    }
    state.db.create_collection(&db, &body.collection).await?;
    Ok((StatusCode::CREATED, Json(json!({ "db": db, "collection": body.collection }))))
}

pub async fn drop_database(
    _claims: WriteAccess,
    State(state): State<AppState>,
    Path(db): Path<String>,
) -> Result<Json<Value>, AppError> {
    if SYSTEM_DATABASES.contains(&db.as_str()) {
        return Err(AppError::BadRequest(format!("Cannot drop system database '{db}'")));
    }
    state.db.drop_database(&db).await?;
    Ok(Json(json!({ "dropped": db })))
}

pub async fn list_collections(
    _claims: ReadAccess,
    State(state): State<AppState>,
    Path(db): Path<String>,
) -> Result<Json<Value>, AppError> {
    let collections = state.db.list_collections(&db).await?;
    Ok(Json(json!({ "collections": collections })))
}

#[derive(Debug, Deserialize)]
pub struct CreateCollectionBody {
    pub name: String,
}

pub async fn create_collection(
    _claims: WriteAccess,
    State(state): State<AppState>,
    Path(db): Path<String>,
    Json(body): Json<CreateCollectionBody>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    state.db.create_collection(&db, &body.name).await?;
    Ok((StatusCode::CREATED, Json(json!({ "db": db, "collection": body.name }))))
}

pub async fn drop_collection(
    _claims: WriteAccess,
    State(state): State<AppState>,
    Path((db, collection)): Path<(String, String)>,
) -> Result<Json<Value>, AppError> {
    state.db.drop_collection(&db, &collection).await?;
    Ok(Json(json!({ "dropped": collection })))
}

pub async fn list_documents(
    _claims: ReadAccess,
    State(state): State<AppState>,
    Path((db, collection)): Path<(String, String)>,
    Query(params): Query<PaginationParams>,
) -> Result<Json<Value>, AppError> {
    let filter: Document = match &params.filter {
        Some(f) => serde_json::from_str(f)
            .ok()
            .and_then(|v: Value| bson::to_document(&v).ok())
            .unwrap_or_default(),
        None => doc! {},
    };

    let sort: Option<Document> = params
        .sort
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .and_then(|v: Value| bson::to_document(&v).ok());

    let skip = (params.page.saturating_sub(1)) * (params.limit as u64);

    let options = FindOptions::builder()
        .skip(skip)
        .limit(params.limit)
        .sort(sort)
        .build();

    let coll: mongodb::Collection<Document> = state.db.collection(&db, &collection);
    let total = coll.count_documents(filter.clone(), None).await?;
    let mut cursor = coll.find(filter, options).await?;
    let mut docs = Vec::new();
    while let Some(doc) = cursor.try_next().await? {
        docs.push(serde_json::to_value(doc).unwrap_or(Value::Null));
    }

    Ok(Json(json!({
        "total": total,
        "page": params.page,
        "limit": params.limit,
        "documents": docs,
    })))
}

pub async fn get_document(
    _claims: ReadAccess,
    State(state): State<AppState>,
    Path((db, collection, id)): Path<(String, String, String)>,
) -> Result<Json<Value>, AppError> {
    let coll: mongodb::Collection<Document> = state.db.collection(&db, &collection);
    let oid = bson::oid::ObjectId::parse_str(&id)
        .map_err(|_| AppError::BadRequest(format!("Invalid ObjectId: {id}")))?;

    let doc = coll
        .find_one(doc! { "_id": oid }, None)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Document {id} not found")))?;

    Ok(Json(serde_json::to_value(doc)?))
}

pub async fn create_document(
    _claims: WriteAccess,
    State(state): State<AppState>,
    Path((db, collection)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, AppError> {
    let coll: mongodb::Collection<Document> = state.db.collection(&db, &collection);
    let document = bson::to_document(&body)?;
    let result = coll.insert_one(document, None).await?;
    let inserted_id = serde_json::to_value(result.inserted_id)?;
    Ok(Json(json!({ "inserted_id": inserted_id })))
}

pub async fn update_document(
    _claims: WriteAccess,
    State(state): State<AppState>,
    Path((db, collection, id)): Path<(String, String, String)>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, AppError> {
    let coll: mongodb::Collection<Document> = state.db.collection(&db, &collection);
    let oid = bson::oid::ObjectId::parse_str(&id)
        .map_err(|_| AppError::BadRequest(format!("Invalid ObjectId: {id}")))?;

    let replacement = bson::to_document(&body)?;
    let result = coll
        .replace_one(doc! { "_id": oid }, replacement, None)
        .await?;

    Ok(Json(json!({
        "matched": result.matched_count,
        "modified": result.modified_count,
    })))
}

pub async fn delete_document(
    _claims: WriteAccess,
    State(state): State<AppState>,
    Path((db, collection, id)): Path<(String, String, String)>,
) -> Result<Json<Value>, AppError> {
    let coll: mongodb::Collection<Document> = state.db.collection(&db, &collection);
    let oid = bson::oid::ObjectId::parse_str(&id)
        .map_err(|_| AppError::BadRequest(format!("Invalid ObjectId: {id}")))?;

    let result = coll.delete_one(doc! { "_id": oid }, None).await?;
    if result.deleted_count == 0 {
        return Err(AppError::NotFound(format!("Document {id} not found")));
    }

    Ok(Json(json!({ "deleted": result.deleted_count })))
}

#[derive(Deserialize)]
pub struct AggregateBody {
    pub pipeline: Vec<Value>,
}

pub async fn aggregate(
    _claims: ReadAccess,
    State(state): State<AppState>,
    Path((db, collection)): Path<(String, String)>,
    Json(body): Json<AggregateBody>,
) -> Result<Json<Value>, AppError> {
    let coll: mongodb::Collection<Document> = state.db.collection(&db, &collection);
    let pipeline: Vec<Document> = body
        .pipeline
        .iter()
        .map(|s| bson::to_document(s).map_err(AppError::BsonSer))
        .collect::<Result<_, _>>()?;

    let mut cursor = coll.aggregate(pipeline, None).await?;
    let mut results = Vec::new();
    while let Some(doc) = cursor.try_next().await? {
        results.push(serde_json::to_value(doc).unwrap_or(Value::Null));
    }

    Ok(Json(json!({ "results": results })))
}

// ── Index management ─────────────────────────────────────────────────────────

pub async fn list_indexes(
    _claims: ReadAccess,
    State(state): State<AppState>,
    Path((db, collection)): Path<(String, String)>,
) -> Result<Json<Value>, AppError> {
    let indexes = state.db.list_indexes(&db, &collection).await?;
    Ok(Json(json!({ "indexes": indexes })))
}

#[derive(Debug, Deserialize)]
pub struct CreateIndexBody {
    pub keys: Value,
    pub name: Option<String>,
    pub unique: Option<bool>,
    pub sparse: Option<bool>,
    pub ttl: Option<u64>,
    pub background: Option<bool>,
}

pub async fn create_index(
    _claims: WriteAccess,
    State(state): State<AppState>,
    Path((db, collection)): Path<(String, String)>,
    Json(body): Json<CreateIndexBody>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let keys = bson::to_document(&body.keys)
        .map_err(|_| AppError::BadRequest("Invalid keys document".into()))?;
    if keys.is_empty() {
        return Err(AppError::BadRequest("Index keys cannot be empty".into()));
    }
    let index_name = state.db
        .create_index(&db, &collection, keys, body.name, body.unique, body.sparse, body.ttl, body.background)
        .await?;
    Ok((StatusCode::CREATED, Json(json!({ "name": index_name }))))
}

pub async fn drop_index(
    _claims: WriteAccess,
    State(state): State<AppState>,
    Path((db, collection, name)): Path<(String, String, String)>,
) -> Result<Json<Value>, AppError> {
    if name == "_id_" {
        return Err(AppError::BadRequest("Cannot drop the _id index".into()));
    }
    state.db.drop_index(&db, &collection, &name).await?;
    Ok(Json(json!({ "dropped": name })))
}
