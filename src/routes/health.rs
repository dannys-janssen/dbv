use axum::{Json, extract::State};
use serde_json::{Value, json};

use crate::{errors::AppError, state::AppState};

pub async fn health(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    state.db.read().await.ping().await?;
    Ok(Json(json!({ "status": "ok" })))
}
