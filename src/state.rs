use axum::extract::FromRef;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::{auth::JwksCache, config::Config, db::DataSource};

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    /// The single active connection, whichever engine it targets.
    pub db: Arc<RwLock<DataSource>>,
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
