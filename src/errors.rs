use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("MongoDB error: {0}")]
    Mongo(#[from] mongodb::error::Error),

    #[error("BSON serialization error: {0}")]
    BsonSer(#[from] bson::ser::Error),

    #[error("BSON deserialization error: {0}")]
    BsonDe(#[from] bson::de::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Unauthorized: {0}")]
    Unauthorized(String),

    #[error("Forbidden: {0}")]
    Forbidden(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            AppError::Mongo(_) => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
            AppError::BsonSer(_) | AppError::BsonDe(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, self.to_string())
            }
            AppError::Json(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            AppError::Unauthorized(_) => (StatusCode::UNAUTHORIZED, self.to_string()),
            AppError::Forbidden(_) => (StatusCode::FORBIDDEN, self.to_string()),
            AppError::NotFound(_) => (StatusCode::NOT_FOUND, self.to_string()),
            AppError::BadRequest(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            AppError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
        };

        let body = Json(json!({ "error": message }));
        (status, body).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use axum::http::StatusCode;
    use axum::response::IntoResponse;

    async fn response_parts(err: AppError) -> (StatusCode, serde_json::Value) {
        let resp = err.into_response();
        let status = resp.status();
        let body_bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
        (status, json)
    }

    #[tokio::test]
    async fn unauthorized_returns_401() {
        let (status, body) = response_parts(AppError::Unauthorized("bad token".into())).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert!(body["error"].as_str().unwrap().contains("bad token"));
    }

    #[tokio::test]
    async fn forbidden_returns_403() {
        let (status, body) = response_parts(AppError::Forbidden("no role".into())).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert!(body["error"].as_str().unwrap().contains("no role"));
    }

    #[tokio::test]
    async fn not_found_returns_404() {
        let (status, body) = response_parts(AppError::NotFound("doc 123".into())).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert!(body["error"].as_str().unwrap().contains("doc 123"));
    }

    #[tokio::test]
    async fn bad_request_returns_400() {
        let (status, body) = response_parts(AppError::BadRequest("invalid JSON".into())).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(body["error"].as_str().unwrap().contains("invalid JSON"));
    }

    #[tokio::test]
    async fn internal_returns_500() {
        let (status, body) = response_parts(AppError::Internal("something broke".into())).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert!(body["error"].as_str().unwrap().contains("something broke"));
    }

    #[tokio::test]
    async fn json_error_returns_400() {
        let json_err: serde_json::Error =
            serde_json::from_str::<serde_json::Value>("not valid json").unwrap_err();
        let (status, _body) = response_parts(AppError::Json(json_err)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn bson_ser_error_returns_500() {
        // Trying to convert a non-Document BSON value via to_document fails with a ser error.
        // A plain string cannot be serialised as a BSON document.
        let bson_err = bson::to_document(&"just a string").unwrap_err();
        let (status, _body) = response_parts(AppError::BsonSer(bson_err)).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn error_display_includes_message() {
        let err = AppError::Unauthorized("test msg".into());
        assert!(err.to_string().contains("test msg"));

        let err = AppError::Forbidden("forbidden msg".into());
        assert!(err.to_string().contains("forbidden msg"));

        let err = AppError::NotFound("not found msg".into());
        assert!(err.to_string().contains("not found msg"));

        let err = AppError::BadRequest("bad request msg".into());
        assert!(err.to_string().contains("bad request msg"));

        let err = AppError::Internal("internal msg".into());
        assert!(err.to_string().contains("internal msg"));
    }
}
