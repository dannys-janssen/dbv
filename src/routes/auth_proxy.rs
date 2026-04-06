use axum::{Json, extract::State};
use serde::Deserialize;
use serde_json::Value;

use crate::{errors::AppError, state::AppState};

#[derive(Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

/// Proxy a password-grant login to Keycloak and return tokens to the frontend.
/// Using a backend proxy avoids CORS issues and keeps the Keycloak internal URL hidden.
pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> Result<Json<Value>, AppError> {
    let token_url = format!(
        "{}/realms/{}/protocol/openid-connect/token",
        state.config.keycloak_url, state.config.keycloak_realm
    );

    let resp = reqwest::Client::new()
        .post(&token_url) // lgtm[rust/ssrf] - token_url is constructed solely from operator-controlled env vars (KEYCLOAK_URL, KEYCLOAK_REALM); no user input is interpolated into the URL
        .form(&[
            ("client_id", state.config.keycloak_client_id.as_str()),
            ("username", body.username.as_str()),
            ("password", body.password.as_str()),
            ("grant_type", "password"),
        ])
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Keycloak request failed: {e}")))?;

    let status = resp.status();
    let data: Value = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Keycloak response parse failed: {e}")))?;

    if !status.is_success() {
        let msg = data["error_description"]
            .as_str()
            .unwrap_or("Login failed")
            .to_string();
        return Err(AppError::Unauthorized(msg));
    }

    Ok(Json(data))
}

/// Proxy a refresh-token grant to Keycloak and return fresh tokens.
pub async fn refresh(
    State(state): State<AppState>,
    Json(body): Json<RefreshRequest>,
) -> Result<Json<Value>, AppError> {
    let token_url = format!(
        "{}/realms/{}/protocol/openid-connect/token",
        state.config.keycloak_url, state.config.keycloak_realm
    );

    let resp = reqwest::Client::new()
        .post(&token_url) // lgtm[rust/ssrf] - token_url is constructed solely from operator-controlled env vars (KEYCLOAK_URL, KEYCLOAK_REALM); no user input is interpolated into the URL
        .form(&[
            ("client_id", state.config.keycloak_client_id.as_str()),
            ("refresh_token", body.refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Keycloak request failed: {e}")))?;

    let status = resp.status();
    let data: Value = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Keycloak response parse failed: {e}")))?;

    if !status.is_success() {
        let msg = data["error_description"]
            .as_str()
            .unwrap_or("Token refresh failed")
            .to_string();
        return Err(AppError::Unauthorized(msg));
    }

    Ok(Json(data))
}
