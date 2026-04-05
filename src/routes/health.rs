use axum::{Json, extract::State};
use serde_json::{Value, json};

use crate::{errors::AppError, state::AppState};

pub async fn health(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let admin_db = state.db.read().await.database("admin");
    admin_db.run_command(bson::doc! { "ping": 1 }).await?;
    Ok(Json(json!({ "status": "ok" })))
}
