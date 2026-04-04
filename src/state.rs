use axum::extract::FromRef;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::{auth::JwksCache, config::Config, db::DbClient};

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub db: Arc<RwLock<DbClient>>,
    pub jwks: JwksCache,
}

impl FromRef<AppState> for Config {
    fn from_ref(state: &AppState) -> Self {
        state.config.clone()
    }
}

impl FromRef<AppState> for JwksCache {
    fn from_ref(state: &AppState) -> Self {
        state.jwks.clone()
    }
}
