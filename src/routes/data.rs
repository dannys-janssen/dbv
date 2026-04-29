use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use bson::{Document, doc};
use futures::TryStreamExt;
use mongodb::options::FindOptions;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    auth::rbac::{ReadAccess, WriteAccess},
    db::CreateIndexParams,
    errors::AppError,
    state::AppState,
};

const SYSTEM_DATABASES: &[&str] = &["admin", "config", "local"];

fn json_to_doc(val: Value) -> Result<Document, AppError> {
    use std::convert::TryFrom;
    match bson::Bson::try_from(val)
        .map_err(|e| AppError::BadRequest(format!("Extended JSON error: {e}")))?
    {
        bson::Bson::Document(d) => Ok(d),
        _ => Err(AppError::BadRequest(
            "Request body must be a JSON object".to_string(),
        )),
    }
}

#[derive(Debug, Deserialize)]
pub struct PaginationParams {
    #[serde(default = "default_page")]
    pub page: u64,
    #[serde(default = "default_limit")]
    pub limit: i64,
    pub filter: Option<String>,
    pub sort: Option<String>,
    pub projection: Option<String>,
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
    let dbs = state.db.read().await.list_databases().await?;
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
        return Err(AppError::BadRequest(format!(
            "Cannot create system database '{db}'"
        )));
    }
    state
        .db
        .read()
        .await
        .create_collection(&db, &body.collection)
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({ "db": db, "collection": body.collection })),
    ))
}

pub async fn drop_database(
    _claims: WriteAccess,
    State(state): State<AppState>,
    Path(db): Path<String>,
) -> Result<Json<Value>, AppError> {
    if SYSTEM_DATABASES.contains(&db.as_str()) {
        return Err(AppError::BadRequest(format!(
            "Cannot drop system database '{db}'"
        )));
    }
    state.db.read().await.drop_database(&db).await?;
    Ok(Json(json!({ "dropped": db })))
}

pub async fn list_collections(
    _claims: ReadAccess,
    State(state): State<AppState>,
    Path(db): Path<String>,
) -> Result<Json<Value>, AppError> {
    let collections = state.db.read().await.list_collections(&db).await?;
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
    state
        .db
        .read()
        .await
        .create_collection(&db, &body.name)
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({ "db": db, "collection": body.name })),
    ))
}

pub async fn drop_collection(
    _claims: WriteAccess,
    State(state): State<AppState>,
    Path((db, collection)): Path<(String, String)>,
) -> Result<Json<Value>, AppError> {
    state
        .db
        .read()
        .await
        .drop_collection(&db, &collection)
        .await?;
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
            .and_then(|v: Value| json_to_doc(v).ok())
            .unwrap_or_default(),
        None => doc! {},
    };

    let sort: Option<Document> = params
        .sort
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .and_then(|v: Value| json_to_doc(v).ok());

    let projection: Option<Document> = params
        .projection
        .as_deref()
        .and_then(|p| serde_json::from_str(p).ok())
        .and_then(|v: Value| json_to_doc(v).ok());

    let skip = (params.page.saturating_sub(1)) * (params.limit as u64);

    let options = FindOptions::builder()
        .skip(skip)
        .limit(params.limit)
        .sort(sort)
        .projection(projection)
        .build();

    let coll: mongodb::Collection<Document> = state.db.read().await.collection(&db, &collection);
    let total = coll.count_documents(filter.clone()).await?;
    let mut cursor = coll.find(filter).with_options(options).await?;
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

fn parse_id_bson(id: &str) -> bson::Bson {
    bson::oid::ObjectId::parse_str(id)
        .map(bson::Bson::ObjectId)
        .unwrap_or_else(|_| bson::Bson::String(id.to_string()))
}

pub async fn get_document(
    _claims: ReadAccess,
    State(state): State<AppState>,
    Path((db, collection, id)): Path<(String, String, String)>,
) -> Result<Json<Value>, AppError> {
    let coll: mongodb::Collection<Document> = state.db.read().await.collection(&db, &collection);
    let doc_id = parse_id_bson(&id);

    let doc = coll
        .find_one(doc! { "_id": doc_id })
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
    let coll: mongodb::Collection<Document> = state.db.read().await.collection(&db, &collection);
    let document = json_to_doc(body)?;
    let result = coll.insert_one(document).await?;
    let inserted_id = serde_json::to_value(result.inserted_id)?;
    Ok(Json(json!({ "inserted_id": inserted_id })))
}

pub async fn update_document(
    _claims: WriteAccess,
    State(state): State<AppState>,
    Path((db, collection, id)): Path<(String, String, String)>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, AppError> {
    let coll: mongodb::Collection<Document> = state.db.read().await.collection(&db, &collection);
    let doc_id = parse_id_bson(&id);

    let replacement = json_to_doc(body)?;
    let result = coll
        .replace_one(doc! { "_id": doc_id }, replacement)
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
    let coll: mongodb::Collection<Document> = state.db.read().await.collection(&db, &collection);
    let doc_id = parse_id_bson(&id);

    let result = coll.delete_one(doc! { "_id": doc_id }).await?;
    if result.deleted_count == 0 {
        return Err(AppError::NotFound(format!("Document {id} not found")));
    }

    Ok(Json(json!({ "deleted": result.deleted_count })))
}

#[derive(Deserialize)]
pub struct BulkDeleteBody {
    pub ids: Vec<String>,
}

pub async fn bulk_delete_documents(
    _claims: WriteAccess,
    State(state): State<AppState>,
    Path((db, collection)): Path<(String, String)>,
    Json(body): Json<BulkDeleteBody>,
) -> Result<Json<Value>, AppError> {
    if body.ids.is_empty() {
        return Err(AppError::BadRequest("No IDs provided".into()));
    }
    let ids: Vec<bson::Bson> = body.ids.iter().map(|id| parse_id_bson(id)).collect();
    let coll: mongodb::Collection<Document> = state.db.read().await.collection(&db, &collection);
    let result = coll.delete_many(doc! { "_id": { "$in": &ids } }).await?;
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
    let coll: mongodb::Collection<Document> = state.db.read().await.collection(&db, &collection);
    let pipeline: Vec<Document> = body
        .pipeline
        .iter()
        .cloned()
        .map(json_to_doc)
        .collect::<Result<_, _>>()?;

    let mut cursor = coll.aggregate(pipeline).await?;
    let mut results = Vec::new();
    while let Some(doc) = cursor.try_next().await? {
        results.push(serde_json::to_value(doc).unwrap_or(Value::Null));
    }

    Ok(Json(json!({ "results": results })))
}

pub async fn list_indexes(
    _claims: ReadAccess,
    State(state): State<AppState>,
    Path((db, collection)): Path<(String, String)>,
) -> Result<Json<Value>, AppError> {
    let indexes = state.db.read().await.list_indexes(&db, &collection).await?;
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
    pub partial_filter_expression: Option<Value>,
}

pub async fn create_index(
    _claims: WriteAccess,
    State(state): State<AppState>,
    Path((db, collection)): Path<(String, String)>,
    Json(body): Json<CreateIndexBody>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let keys =
        json_to_doc(body.keys).map_err(|_| AppError::BadRequest("Invalid keys document".into()))?;
    if keys.is_empty() {
        return Err(AppError::BadRequest("Index keys cannot be empty".into()));
    }
    let partial_filter_expression = body
        .partial_filter_expression
        .map(|v| json_to_doc(v).map_err(|_| AppError::BadRequest("Invalid partialFilterExpression document".into())))
        .transpose()?;
    let index_name = state
        .db
        .read()
        .await
        .create_index(
            &db,
            &collection,
            CreateIndexParams {
                keys,
                name: body.name,
                unique: body.unique,
                sparse: body.sparse,
                ttl: body.ttl,
                background: body.background,
                partial_filter_expression,
            },
        )
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
    state
        .db
        .read()
        .await
        .drop_index(&db, &collection, &name)
        .await?;
    Ok(Json(json!({ "dropped": name })))
}

pub async fn database_stats(
    _claims: ReadAccess,
    State(state): State<AppState>,
    Path(db): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = state.db.read().await.database(&db);
    let doc = database
        .run_command(bson::doc! { "dbStats": 1, "scale": 1 })
        .await?;
    Ok(Json(serde_json::to_value(doc)?))
}

pub async fn collection_stats(
    _claims: ReadAccess,
    State(state): State<AppState>,
    Path((db, collection)): Path<(String, String)>,
) -> Result<Json<Value>, AppError> {
    let database = state.db.read().await.database(&db);
    let doc = database
        .run_command(bson::doc! { "collStats": &collection, "scale": 1 })
        .await?;
    Ok(Json(serde_json::to_value(doc)?))
}

#[derive(Debug, Deserialize)]
pub struct RunCommandBody {
    pub command: Value,
    #[serde(default)]
    pub admin: bool,
}

pub async fn run_command(
    _claims: WriteAccess,
    State(state): State<AppState>,
    Path(db): Path<String>,
    Json(body): Json<RunCommandBody>,
) -> Result<Json<Value>, AppError> {
    let cmd_doc: bson::Document = serde_json::from_value(body.command)
        .map_err(|e| AppError::BadRequest(format!("Invalid command document: {e}")))?;
    let result = state
        .db
        .read()
        .await
        .run_command(&db, cmd_doc, body.admin)
        .await?;
    Ok(Json(json!({ "result": result })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ── json_to_doc ───────────────────────────────────────────────────────────

    #[test]
    fn json_to_doc_converts_plain_object() {
        let val = json!({ "name": "Alice", "age": 30 });
        let doc = json_to_doc(val).unwrap();
        assert_eq!(doc.get_str("name").unwrap(), "Alice");
        assert_eq!(doc.get_i32("age").unwrap(), 30);
    }

    #[test]
    fn json_to_doc_converts_extended_json_oid() {
        let val = json!({ "_id": { "$oid": "507f1f77bcf86cd799439011" } });
        let doc = json_to_doc(val).unwrap();
        let id = doc.get_object_id("_id").unwrap();
        assert_eq!(id.to_hex(), "507f1f77bcf86cd799439011");
    }

    #[test]
    fn json_to_doc_converts_extended_json_date() {
        let val = json!({ "created": { "$date": { "$numberLong": "0" } } });
        let doc = json_to_doc(val).unwrap();
        // Should deserialise without error
        assert!(doc.contains_key("created"));
    }

    #[test]
    fn json_to_doc_returns_error_for_non_object() {
        let val = json!([1, 2, 3]);
        let err = json_to_doc(val).unwrap_err();
        match err {
            AppError::BadRequest(_) => {}
            other => panic!("Expected BadRequest, got {other:?}"),
        }
    }

    #[test]
    fn json_to_doc_returns_error_for_primitive() {
        let val = json!(42);
        let err = json_to_doc(val).unwrap_err();
        match err {
            AppError::BadRequest(_) => {}
            other => panic!("Expected BadRequest, got {other:?}"),
        }
    }

    #[test]
    fn json_to_doc_empty_object_produces_empty_document() {
        let val = json!({});
        let doc = json_to_doc(val).unwrap();
        assert!(doc.is_empty());
    }

    // ── parse_id_bson ─────────────────────────────────────────────────────────

    #[test]
    fn parse_id_bson_parses_valid_object_id() {
        let bson_val = parse_id_bson("507f1f77bcf86cd799439011");
        match bson_val {
            bson::Bson::ObjectId(oid) => assert_eq!(oid.to_hex(), "507f1f77bcf86cd799439011"),
            other => panic!("Expected ObjectId, got {other:?}"),
        }
    }

    #[test]
    fn parse_id_bson_falls_back_to_string_for_non_hex() {
        let bson_val = parse_id_bson("not-an-objectid");
        match bson_val {
            bson::Bson::String(s) => assert_eq!(s, "not-an-objectid"),
            other => panic!("Expected String, got {other:?}"),
        }
    }

    #[test]
    fn parse_id_bson_falls_back_to_string_for_short_hex() {
        // 22 hex chars — too short for a valid ObjectId (needs exactly 24)
        let bson_val = parse_id_bson("507f1f77bcf86cd7994390");
        match bson_val {
            bson::Bson::String(_) => {}
            other => panic!("Expected String fallback, got {other:?}"),
        }
    }

    #[test]
    fn parse_id_bson_falls_back_to_string_for_empty_id() {
        let bson_val = parse_id_bson("");
        match bson_val {
            bson::Bson::String(s) => assert_eq!(s, ""),
            other => panic!("Expected String, got {other:?}"),
        }
    }

    // ── SYSTEM_DATABASES constant ─────────────────────────────────────────────

    #[test]
    fn system_databases_contains_known_system_dbs() {
        assert!(SYSTEM_DATABASES.contains(&"admin"));
        assert!(SYSTEM_DATABASES.contains(&"config"));
        assert!(SYSTEM_DATABASES.contains(&"local"));
    }

    #[test]
    fn system_databases_does_not_contain_user_db() {
        assert!(!SYSTEM_DATABASES.contains(&"myapp"));
        assert!(!SYSTEM_DATABASES.contains(&"production"));
    }
}
