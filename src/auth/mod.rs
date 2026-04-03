pub mod rbac;

use axum::{
    extract::{FromRef, FromRequestParts, State},
    http::{request::Parts, HeaderMap},
    RequestPartsExt,
};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use reqwest::Client as HttpClient;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::{config::Config, errors::AppError};

/// Cached JWKS keys fetched from Keycloak.
#[derive(Clone)]
pub struct JwksCache {
    inner: Arc<RwLock<Option<Vec<Jwk>>>>,
    http: HttpClient,
    jwks_url: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Jwk {
    pub kid: String,
    pub kty: String,
    pub alg: Option<String>,
    pub n: Option<String>,
    pub e: Option<String>,
}

#[derive(Debug, Deserialize)]
struct JwksResponse {
    keys: Vec<Jwk>,
}

impl JwksCache {
    pub fn new(config: &Config) -> Self {
        Self {
            inner: Arc::new(RwLock::new(None)),
            http: HttpClient::new(),
            jwks_url: config.jwks_url(),
        }
    }

    pub async fn get_keys(&self) -> Result<Vec<Jwk>, AppError> {
        // Return cached keys if available
        {
            let guard = self.inner.read().await;
            if let Some(keys) = guard.as_ref() {
                return Ok(keys.clone());
            }
        }
        self.refresh().await
    }

    pub async fn refresh(&self) -> Result<Vec<Jwk>, AppError> {
        let resp: JwksResponse = self
            .http
            .get(&self.jwks_url)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("JWKS fetch failed: {e}")))?
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("JWKS parse failed: {e}")))?;

        let mut guard = self.inner.write().await;
        *guard = Some(resp.keys.clone());
        Ok(resp.keys)
    }
}

/// JWT claims extracted from a validated Keycloak token.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String,
    pub preferred_username: Option<String>,
    pub email: Option<String>,
    pub realm_access: Option<RealmAccess>,
    pub exp: usize,
    pub iat: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RealmAccess {
    pub roles: Vec<String>,
}

impl Claims {
    pub fn has_role(&self, role: &str) -> bool {
        self.realm_access
            .as_ref()
            .map(|ra| ra.roles.iter().any(|r| r == role))
            .unwrap_or(false)
    }
}

/// Axum extractor that validates the Bearer JWT and returns Claims.
#[axum::async_trait]
impl<S> FromRequestParts<S> for Claims
where
    Config: FromRef<S>,
    JwksCache: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let token = extract_bearer_token(&parts.headers)
            .ok_or_else(|| AppError::Unauthorized("Missing or invalid Authorization header".into()))?;

        let config = Config::from_ref(state);
        let jwks_cache = JwksCache::from_ref(state);

        validate_token(&token, &config, &jwks_cache).await
    }
}

fn extract_bearer_token(headers: &HeaderMap) -> Option<String> {
    let auth = headers.get("Authorization")?.to_str().ok()?;
    auth.strip_prefix("Bearer ").map(|s| s.to_string())
}

async fn validate_token(
    token: &str,
    config: &Config,
    jwks_cache: &JwksCache,
) -> Result<Claims, AppError> {
    let header = decode_header(token)
        .map_err(|_| AppError::Unauthorized("Invalid token header".into()))?;

    let kid = header
        .kid
        .ok_or_else(|| AppError::Unauthorized("Token missing kid".into()))?;

    let keys = jwks_cache.get_keys().await?;
    let jwk_owned: Jwk = match find_key(&keys, &kid) {
        Some(k) => k.clone(),
        None => {
            let fresh = jwks_cache.refresh().await?;
            find_key(&fresh, &kid)
                .ok_or_else(|| AppError::Unauthorized(format!("Unknown key id: {kid}")))?
                .clone()
        }
    };

    let decoding_key = build_decoding_key(&jwk_owned)?;

    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[&config.keycloak_client_id]);

    let data = decode::<Claims>(token, &decoding_key, &validation)
        .map_err(|e| AppError::Unauthorized(format!("Token validation failed: {e}")))?;

    Ok(data.claims)
}

fn find_key<'a>(keys: &'a [Jwk], kid: &str) -> Option<&'a Jwk> {
    keys.iter().find(|k| k.kid == kid)
}

fn build_decoding_key(jwk: &Jwk) -> Result<DecodingKey, AppError> {
    let n = jwk
        .n
        .as_deref()
        .ok_or_else(|| AppError::Internal("JWK missing 'n'".into()))?;
    let e = jwk
        .e
        .as_deref()
        .ok_or_else(|| AppError::Internal("JWK missing 'e'".into()))?;
    DecodingKey::from_rsa_components(n, e)
        .map_err(|e| AppError::Internal(format!("Failed to build decoding key: {e}")))
}
