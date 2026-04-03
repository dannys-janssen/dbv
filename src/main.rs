use axum::{
    routing::{delete, get, post, put},
    Router,
};
use std::net::SocketAddr;
use tower_http::{
    cors::{Any, CorsLayer},
    services::ServeDir,
    trace::TraceLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod auth;
mod config;
mod db;
mod errors;
mod routes;
mod state;

use config::Config;
use db::DbClient;
use state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "dbv=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Config::from_env().unwrap_or_else(|e| {
        eprintln!("Configuration error: {e}");
        std::process::exit(1);
    });

    let db = DbClient::new(&config).await.unwrap_or_else(|e| {
        eprintln!("Failed to connect to MongoDB: {e}");
        std::process::exit(1);
    });

    let jwks = auth::JwksCache::new(&config);
    if let Err(e) = jwks.get_keys().await {
        tracing::warn!("Could not pre-fetch JWKS (will retry on first request): {e}");
    }

    let state = AppState {
        config: config.clone(),
        db,
        jwks,
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let api = Router::new()
        .route("/health", get(routes::health::health))
        .route("/databases", get(routes::data::list_databases))
        .route(
            "/databases/{db}/collections",
            get(routes::data::list_collections),
        )
        .route(
            "/databases/{db}/collections/{collection}/documents",
            get(routes::data::list_documents).post(routes::data::create_document),
        )
        .route(
            "/databases/{db}/collections/{collection}/documents/{id}",
            get(routes::data::get_document)
                .put(routes::data::update_document)
                .delete(routes::data::delete_document),
        )
        .route(
            "/databases/{db}/collections/{collection}/aggregate",
            post(routes::data::aggregate),
        )
        .route(
            "/databases/{db}/collections/{collection}/schema",
            get(routes::schema::collection_schema),
        )
        .route(
            "/databases/{db}/collections/{collection}/export",
            get(routes::transfer::export_collection),
        )
        .route(
            "/databases/{db}/collections/{collection}/import",
            post(routes::transfer::import_collection),
        );

    let frontend_dist = config.frontend_dist.clone();
    let app = Router::new()
        .nest("/api", api)
        .fallback_service(ServeDir::new(&frontend_dist).append_index_html_on_directories(true))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr: SocketAddr = format!("{}:{}", config.server_host, config.server_port)
        .parse()
        .expect("Invalid server address");

    tracing::info!("Listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
