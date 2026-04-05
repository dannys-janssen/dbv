use axum::extract::{FromRef, FromRequestParts};
use axum::http::request::Parts;

use crate::auth::{Claims, JwksCache};
use crate::config::Config;
use crate::errors::AppError;

/// Accepted by any authenticated user with `dbv-viewer` OR `dbv-admin`.
pub struct ReadAccess(pub Claims);

/// Accepted only by users with `dbv-admin`.
pub struct WriteAccess(#[allow(dead_code)] pub Claims);

impl<S> FromRequestParts<S> for ReadAccess
where
    Config: FromRef<S>,
    JwksCache: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let claims = Claims::from_request_parts(parts, state).await?;
        if claims.has_role("dbv-admin") || claims.has_role("dbv-viewer") {
            Ok(ReadAccess(claims))
        } else {
            Err(AppError::Forbidden(
                "Required role: dbv-viewer or dbv-admin".into(),
            ))
        }
    }
}

impl<S> FromRequestParts<S> for WriteAccess
where
    Config: FromRef<S>,
    JwksCache: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let claims = Claims::from_request_parts(parts, state).await?;
        if claims.has_role("dbv-admin") {
            Ok(WriteAccess(claims))
        } else {
            Err(AppError::Forbidden("Required role: dbv-admin".into()))
        }
    }
}
