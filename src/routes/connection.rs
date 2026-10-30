use axum::{Json, extract::State};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    auth::rbac::ReadAccess,
    db::{DataSource, DbClient, Engine, MySqlClient},
    errors::AppError,
    state::AppState,
};

#[derive(Deserialize)]
pub struct SetConnectionRequest {
    pub uri: String,
    pub default_db: Option<String>,
    /// Target engine; defaults to the currently active one when omitted.
    pub engine: Option<Engine>,
    pub tls_ca_file: Option<String>,
    pub tls_cert_key_file: Option<String>,
    #[serde(default)]
    pub tls_allow_invalid_certs: bool,
}

/// Identity and TLS settings of a connection, captured so a replacement
/// client can be built without holding the lock.
struct ConnSettings {
    engine: Engine,
    uri: String,
    default_db: String,
    tls_ca_file: Option<String>,
    tls_cert_key_file: Option<String>,
    tls_allow_invalid_certs: bool,
}

fn settings_of(source: &DataSource) -> ConnSettings {
    match source {
        DataSource::Mongo(c) => ConnSettings {
            engine: Engine::Mongo,
            uri: c.uri.clone(),
            default_db: c.default_db.clone(),
            tls_ca_file: c.tls_ca_file.clone(),
            tls_cert_key_file: c.tls_cert_key_file.clone(),
            tls_allow_invalid_certs: c.tls_allow_invalid_certs,
        },
        DataSource::MySql(c) => ConnSettings {
            engine: Engine::MySql,
            uri: c.uri.clone(),
            default_db: c.default_db.clone(),
            tls_ca_file: c.tls_ca_file.clone(),
            tls_cert_key_file: None,
            tls_allow_invalid_certs: c.tls_allow_invalid_certs,
        },
    }
}

/// Build a new data source without touching the active one.
async fn connect(engine: Engine, s: &ConnSettings) -> Result<DataSource, AppError> {
    match engine {
        Engine::Mongo => Ok(DataSource::Mongo(
            DbClient::from_uri_with_tls(
                &s.uri,
                &s.default_db,
                s.tls_ca_file.clone(),
                s.tls_cert_key_file.clone(),
                s.tls_allow_invalid_certs,
            )
            .await
            .map_err(|e| AppError::BadRequest(e.to_string()))?,
        )),
        Engine::MySql => Ok(DataSource::MySql(
            MySqlClient::from_uri_with_tls(
                &s.uri,
                Some(s.default_db.as_str()).filter(|d| !d.is_empty()),
                s.tls_ca_file.clone(),
                s.tls_allow_invalid_certs,
            )
            .await
            .map_err(|e| AppError::BadRequest(e.to_string()))?,
        )),
    }
}

fn describe(source: &DataSource, status: &str, error: Option<String>) -> Value {
    let s = settings_of(source);
    json!({
        "engine": s.engine,
        "uri": source.masked_uri(),
        "default_db": s.default_db,
        "status": status,
        "error": error,
        "tls_ca_file": s.tls_ca_file,
        "tls_cert_key_file": s.tls_cert_key_file,
        "tls_allow_invalid_certs": s.tls_allow_invalid_certs,
    })
}

pub async fn get_connection(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let source = state.db.read().await;
    let (status, error) = match source.ping().await {
        Ok(_) => ("ok", None::<String>),
        Err(e) => ("error", Some(e.to_string())),
    };
    Ok(Json(describe(&source, status, error)))
}

pub async fn set_connection(
    State(state): State<AppState>,
    _auth: ReadAccess,
    Json(body): Json<SetConnectionRequest>,
) -> Result<Json<Value>, AppError> {
    let current = settings_of(&*state.db.read().await);
    let engine = body.engine.unwrap_or(current.engine);

    let requested = ConnSettings {
        engine,
        uri: body.uri,
        default_db: body.default_db.unwrap_or(current.default_db),
        tls_ca_file: body.tls_ca_file,
        tls_cert_key_file: body.tls_cert_key_file,
        tls_allow_invalid_certs: body.tls_allow_invalid_certs,
    };

    let new_source = connect(engine, &requested).await?;
    let payload = describe(&new_source, "ok", None);
    *state.db.write().await = new_source;
    Ok(Json(payload))
}

pub async fn reconnect(
    State(state): State<AppState>,
    _auth: ReadAccess,
) -> Result<Json<Value>, AppError> {
    let current = settings_of(&*state.db.read().await);
    let new_source = connect(current.engine, &current).await?;
    let payload = describe(&new_source, "ok", None);
    *state.db.write().await = new_source;
    Ok(Json(payload))
}
