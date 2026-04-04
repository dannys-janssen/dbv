use axum::{extract::State, Json};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{auth::rbac::ReadAccess, db::DbClient, errors::AppError, state::AppState};

#[derive(Deserialize)]
pub struct SetConnectionRequest {
    pub uri: String,
    pub default_db: Option<String>,
}

pub async fn get_connection(
    State(state): State<AppState>,
) -> Result<Json<Value>, AppError> {
    let dbc = state.db.read().await;
    let (status, error) = match dbc
        .run_command("admin", bson::doc! { "ping": 1 }, true)
        .await
    {
        Ok(_) => ("ok".to_string(), None::<String>),
        Err(e) => ("error".to_string(), Some(e.to_string())),
    };
    Ok(Json(json!({
        "uri": dbc.masked_uri(),
        "default_db": dbc.default_db,
        "status": status,
        "error": error,
    })))
}

pub async fn set_connection(
    State(state): State<AppState>,
    _auth: ReadAccess,
    Json(body): Json<SetConnectionRequest>,
) -> Result<Json<Value>, AppError> {
    let default_db = {
        let dbc = state.db.read().await;
        body.default_db.clone().unwrap_or_else(|| dbc.default_db.clone())
    };

    let new_client = DbClient::from_uri(&body.uri, &default_db)
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;

    let masked = new_client.masked_uri();
    let new_default_db = new_client.default_db.clone();

    *state.db.write().await = new_client;

    Ok(Json(json!({
        "uri": masked,
        "default_db": new_default_db,
        "status": "ok",
    })))
}

pub async fn reconnect(
    State(state): State<AppState>,
    _auth: ReadAccess,
) -> Result<Json<Value>, AppError> {
    let (uri, default_db) = {
        let dbc = state.db.read().await;
        (dbc.uri.clone(), dbc.default_db.clone())
    };

    let new_client = DbClient::from_uri(&uri, &default_db)
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;

    let masked = new_client.masked_uri();
    let new_default_db = new_client.default_db.clone();

    *state.db.write().await = new_client;

    Ok(Json(json!({
        "uri": masked,
        "default_db": new_default_db,
        "status": "ok",
    })))
}
