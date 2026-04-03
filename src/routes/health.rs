use axum::{extract::State, Json};
use serde_json::{json, Value};

use crate::{errors::AppError, state::AppState};

pub async fn health(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    state
        .db
        .database("admin")
        .run_command(bson::doc! { "ping": 1 }, None)
        .await?;
    Ok(Json(json!({ "status": "ok" })))
}
