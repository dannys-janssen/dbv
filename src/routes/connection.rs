use axum::{Json, extract::State};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{auth::rbac::ReadAccess, db::DbClient, errors::AppError, state::AppState};

#[derive(Deserialize)]
pub struct SetConnectionRequest {
    pub uri: String,
    pub default_db: Option<String>,
    pub tls_ca_file: Option<String>,
    pub tls_cert_key_file: Option<String>,
    #[serde(default)]
    pub tls_allow_invalid_certs: bool,
}

pub async fn get_connection(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
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
        "tls_ca_file": dbc.tls_ca_file,
        "tls_cert_key_file": dbc.tls_cert_key_file,
        "tls_allow_invalid_certs": dbc.tls_allow_invalid_certs,
    })))
}

pub async fn set_connection(
    State(state): State<AppState>,
    _auth: ReadAccess,
    Json(body): Json<SetConnectionRequest>,
) -> Result<Json<Value>, AppError> {
    let default_db = {
        let dbc = state.db.read().await;
        body.default_db
            .clone()
            .unwrap_or_else(|| dbc.default_db.clone())
    };

    let new_client = DbClient::from_uri_with_tls(
        &body.uri,
        &default_db,
        body.tls_ca_file,
        body.tls_cert_key_file,
        body.tls_allow_invalid_certs,
    )
    .await
    .map_err(|e| AppError::BadRequest(e.to_string()))?;

    let masked = new_client.masked_uri();
    let new_default_db = new_client.default_db.clone();
    let tls_ca_file = new_client.tls_ca_file.clone();
    let tls_cert_key_file = new_client.tls_cert_key_file.clone();
    let tls_allow_invalid_certs = new_client.tls_allow_invalid_certs;

    *state.db.write().await = new_client;

    Ok(Json(json!({
        "uri": masked,
        "default_db": new_default_db,
        "status": "ok",
        "tls_ca_file": tls_ca_file,
        "tls_cert_key_file": tls_cert_key_file,
        "tls_allow_invalid_certs": tls_allow_invalid_certs,
    })))
}

pub async fn reconnect(
    State(state): State<AppState>,
    _auth: ReadAccess,
) -> Result<Json<Value>, AppError> {
    let (uri, default_db, tls_ca_file, tls_cert_key_file, tls_allow_invalid_certs) = {
        let dbc = state.db.read().await;
        (
            dbc.uri.clone(),
            dbc.default_db.clone(),
            dbc.tls_ca_file.clone(),
            dbc.tls_cert_key_file.clone(),
            dbc.tls_allow_invalid_certs,
        )
    };

    let new_client = DbClient::from_uri_with_tls(
        &uri,
        &default_db,
        tls_ca_file,
        tls_cert_key_file,
        tls_allow_invalid_certs,
    )
    .await
    .map_err(|e| AppError::BadRequest(e.to_string()))?;

    let masked = new_client.masked_uri();
    let new_default_db = new_client.default_db.clone();
    let new_tls_ca = new_client.tls_ca_file.clone();
    let new_tls_cert = new_client.tls_cert_key_file.clone();
    let new_tls_invalid = new_client.tls_allow_invalid_certs;

    *state.db.write().await = new_client;

    Ok(Json(json!({
        "uri": masked,
        "default_db": new_default_db,
        "status": "ok",
        "tls_ca_file": new_tls_ca,
        "tls_cert_key_file": new_tls_cert,
        "tls_allow_invalid_certs": new_tls_invalid,
    })))
}
