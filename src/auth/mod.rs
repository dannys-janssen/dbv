pub mod rbac;

use axum::extract::{FromRef, FromRequestParts};
use axum::http::{HeaderMap, request::Parts};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header};
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
    #[allow(dead_code)]
    pub kty: String,
    #[allow(dead_code)]
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
    /// Authorized party — Keycloak sets this to the client_id that requested the token.
    pub azp: Option<String>,
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
impl<S> FromRequestParts<S> for Claims
where
    Config: FromRef<S>,
    JwksCache: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let token = extract_bearer_token(&parts.headers).ok_or_else(|| {
            AppError::Unauthorized("Missing or invalid Authorization header".into())
        })?;

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
    let header =
        decode_header(token).map_err(|_| AppError::Unauthorized("Invalid token header".into()))?;

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
    // Keycloak tokens carry aud=["account"] by default, not the client_id.
    // We instead verify the azp (authorized party) claim after decoding.
    validation.validate_aud = false;

    let data = decode::<Claims>(token, &decoding_key, &validation)
        .map_err(|e| AppError::Unauthorized(format!("Token validation failed: {e}")))?;

    // Verify the token was actually issued for our client.
    if let Some(azp) = &data.claims.azp
        && azp != &config.keycloak_client_id
    {
        return Err(AppError::Unauthorized(format!(
            "Token azp '{azp}' does not match expected client '{}'",
            config.keycloak_client_id
        )));
    }

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

#[cfg(test)]
mod tests {
    use super::*;

    fn make_claims(roles: Vec<&str>) -> Claims {
        Claims {
            sub: "user-123".to_string(),
            preferred_username: Some("alice".to_string()),
            email: Some("alice@example.com".to_string()),
            realm_access: Some(RealmAccess {
                roles: roles.into_iter().map(str::to_string).collect(),
            }),
            azp: Some("dbv".to_string()),
            exp: 9999999999,
            iat: 0,
        }
    }

    // ── Claims::has_role ──────────────────────────────────────────────────────

    #[test]
    fn has_role_returns_true_for_matching_role() {
        let claims = make_claims(vec!["dbv-admin", "offline_access"]);
        assert!(claims.has_role("dbv-admin"));
    }

    #[test]
    fn has_role_returns_false_for_missing_role() {
        let claims = make_claims(vec!["dbv-viewer"]);
        assert!(!claims.has_role("dbv-admin"));
    }

    #[test]
    fn has_role_returns_false_when_no_realm_access() {
        let claims = Claims {
            sub: "user-1".to_string(),
            preferred_username: None,
            email: None,
            realm_access: None,
            azp: None,
            exp: 9999999999,
            iat: 0,
        };
        assert!(!claims.has_role("dbv-admin"));
    }

    #[test]
    fn has_role_returns_false_for_empty_roles() {
        let claims = make_claims(vec![]);
        assert!(!claims.has_role("dbv-viewer"));
    }

    #[test]
    fn has_role_is_case_sensitive() {
        let claims = make_claims(vec!["DBV-ADMIN"]);
        assert!(!claims.has_role("dbv-admin"));
    }

    // ── find_key ──────────────────────────────────────────────────────────────

    #[test]
    fn find_key_returns_matching_key() {
        let keys = vec![
            Jwk {
                kid: "key1".to_string(),
                kty: "RSA".to_string(),
                alg: None,
                n: None,
                e: None,
            },
            Jwk {
                kid: "key2".to_string(),
                kty: "RSA".to_string(),
                alg: None,
                n: None,
                e: None,
            },
        ];
        let found = find_key(&keys, "key2");
        assert!(found.is_some());
        assert_eq!(found.unwrap().kid, "key2");
    }

    #[test]
    fn find_key_returns_none_when_not_found() {
        let keys = vec![Jwk {
            kid: "key1".to_string(),
            kty: "RSA".to_string(),
            alg: None,
            n: None,
            e: None,
        }];
        assert!(find_key(&keys, "missing").is_none());
    }

    #[test]
    fn find_key_returns_none_on_empty_slice() {
        let keys: Vec<Jwk> = vec![];
        assert!(find_key(&keys, "any").is_none());
    }

    // ── build_decoding_key ────────────────────────────────────────────────────

    #[test]
    fn build_decoding_key_fails_when_n_is_missing() {
        let jwk = Jwk {
            kid: "k1".to_string(),
            kty: "RSA".to_string(),
            alg: Some("RS256".to_string()),
            n: None,
            e: Some("AQAB".to_string()),
        };
        let result = build_decoding_key(&jwk);
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Internal(msg) => assert!(msg.contains("JWK missing 'n'")),
            other => panic!("Expected Internal error, got {other:?}"),
        }
    }

    #[test]
    fn build_decoding_key_fails_when_e_is_missing() {
        let jwk = Jwk {
            kid: "k1".to_string(),
            kty: "RSA".to_string(),
            alg: Some("RS256".to_string()),
            n: Some("some_n".to_string()),
            e: None,
        };
        let result = build_decoding_key(&jwk);
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Internal(msg) => assert!(msg.contains("JWK missing 'e'")),
            other => panic!("Expected Internal error, got {other:?}"),
        }
    }

    #[test]
    fn build_decoding_key_fails_for_invalid_rsa_components() {
        let jwk = Jwk {
            kid: "k1".to_string(),
            kty: "RSA".to_string(),
            alg: Some("RS256".to_string()),
            n: Some("not_valid_base64url!!!".to_string()),
            e: Some("AQAB".to_string()),
        };
        let result = build_decoding_key(&jwk);
        assert!(result.is_err());
    }

    // ── extract_bearer_token (tested indirectly via pub helper) ──────────────

    #[test]
    fn extract_bearer_token_returns_token_from_valid_header() {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert(
            axum::http::header::AUTHORIZATION,
            "Bearer mytoken123".parse().unwrap(),
        );
        let token = super::extract_bearer_token(&headers);
        assert_eq!(token, Some("mytoken123".to_string()));
    }

    #[test]
    fn extract_bearer_token_returns_none_when_header_missing() {
        let headers = axum::http::HeaderMap::new();
        assert!(super::extract_bearer_token(&headers).is_none());
    }

    #[test]
    fn extract_bearer_token_returns_none_for_basic_auth() {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert(
            axum::http::header::AUTHORIZATION,
            "Basic dXNlcjpwYXNz".parse().unwrap(),
        );
        assert!(super::extract_bearer_token(&headers).is_none());
    }

    #[test]
    fn extract_bearer_token_returns_none_for_empty_auth_header() {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert(axum::http::header::AUTHORIZATION, "".parse().unwrap());
        assert!(super::extract_bearer_token(&headers).is_none());
    }
}
