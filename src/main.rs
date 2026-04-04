use axum::{
    routing::{delete, get, post},
    Router,
};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::{
    cors::{Any, CorsLayer},
    services::{ServeDir, ServeFile},
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
                .unwrap_or_else(|_| "dbv=info,tower_http=warn".into()),
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
        db: Arc::new(RwLock::new(db)),
        jwks,
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let api = Router::new()
        .route("/health", get(routes::health::health))
        .route("/auth/login", post(routes::auth_proxy::login))
        .route("/auth/refresh", post(routes::auth_proxy::refresh))
        .route(
            "/databases",
            get(routes::data::list_databases),
        )
        .route(
            "/databases/:db",
            post(routes::data::create_database).delete(routes::data::drop_database),
        )
        .route(
            "/databases/:db/collections",
            get(routes::data::list_collections).post(routes::data::create_collection),
        )
        .route(
            "/databases/:db/collections/:collection",
            delete(routes::data::drop_collection),
        )
        .route(
            "/databases/:db/collections/:collection/documents",
            get(routes::data::list_documents)
                .post(routes::data::create_document)
                .delete(routes::data::bulk_delete_documents),
        )
        .route(
            "/databases/:db/collections/:collection/documents/:id",
            get(routes::data::get_document)
                .put(routes::data::update_document)
                .delete(routes::data::delete_document),
        )
        .route(
            "/databases/:db/collections/:collection/aggregate",
            post(routes::data::aggregate),
        )
        .route(
            "/databases/:db/stats",
            get(routes::data::database_stats),
        )
        .route(
            "/databases/:db/collections/:collection/stats",
            get(routes::data::collection_stats),
        )
        .route(
            "/databases/:db/collections/:collection/indexes",
            get(routes::data::list_indexes).post(routes::data::create_index),
        )
        .route(
            "/databases/:db/collections/:collection/indexes/:name",
            delete(routes::data::drop_index),
        )
        .route(
            "/databases/:db/collections/:collection/schema",
            get(routes::schema::collection_schema),
        )
        .route(
            "/databases/:db/collections/:collection/export",
            get(routes::transfer::export_collection),
        )
        .route(
            "/databases/:db/collections/:collection/import",
            post(routes::transfer::import_collection),
        )
        .route(
            "/databases/:db/run_command",
            post(routes::data::run_command),
        )
        .route("/connection", get(routes::connection::get_connection).post(routes::connection::set_connection))
        .route("/connection/reconnect", post(routes::connection::reconnect));

    let frontend_dist = config.frontend_dist.clone();
    let index_html = format!("{}/index.html", frontend_dist);
    // Serve the entire frontend dist, falling back to index.html for SPA client-side routing.
    // SPA fallback: serve dist files, fall back to index.html for client-side routes.
    // Must use .fallback() not .not_found_service() — the latter forces status 404
    // which breaks client-side routing behind proxies like Traefik.
    let spa_service = ServeDir::new(&frontend_dist)
        .fallback(ServeFile::new(&index_html));
    let app = Router::new()
        .nest("/api", api)
        .fallback_service(spa_service)
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
