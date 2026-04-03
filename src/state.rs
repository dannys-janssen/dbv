use axum::extract::FromRef;

use crate::{auth::JwksCache, config::Config, db::DbClient};

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub db: DbClient,
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
