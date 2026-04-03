# Copilot Instructions

## Project Overview

**dbv** is a Rust-based web application that provides a browser UI for viewing and editing MongoDB data and structure. It runs as a Docker container alongside MongoDB and a Keycloak authentication service, orchestrated via `docker-compose`.

## Architecture

```
browser
  └── React SPA (static assets served by Axum)
        └── REST/WebSocket API
              └── Axum (Rust backend)
                    ├── MongoDB (mongodb crate, separate container)
                    └── Keycloak (JWT validation, separate container)
```

- **Backend**: Rust, Axum, Tokio async runtime
- **Frontend**: React SPA, built separately, served as static files by Axum from an embedded or mounted `dist/` directory
- **Auth**: OAuth2 / OIDC via Keycloak; the backend validates JWT bearer tokens on protected routes
- **Database**: MongoDB accessed via the official `mongodb` Rust crate (async)
- **Deployment**: Docker container + `docker-compose.yml`

### Directory Layout (intended)

```
/
├── src/                  # Rust backend source
│   ├── main.rs           # Entry point: loads config, builds Axum router, starts server
│   ├── config.rs         # App configuration from environment variables
│   ├── auth/             # JWT validation middleware, Keycloak OIDC integration
│   ├── db/               # MongoDB client setup and query helpers
│   ├── routes/           # Axum route handlers grouped by feature
│   └── errors.rs         # Unified error type implementing IntoResponse
├── frontend/             # React SPA (separate package.json / build tooling)
│   ├── src/
│   └── dist/             # Built output, served by Axum at runtime
├── Dockerfile
├── docker-compose.yml
└── Cargo.toml
```

## Build, Test & Run

### Rust backend

```bash
cargo build                        # debug build
cargo build --release              # release build
cargo test                         # run all tests
cargo test <module>::<test_name>   # run a single test
cargo clippy -- -D warnings        # lint
cargo fmt --check                  # check formatting
```

### Frontend (React)

```bash
cd frontend
npm install
npm run build        # outputs to frontend/dist/
npm run dev          # local dev server with HMR
npm test             # run tests
npm test -- --testNamePattern="<name>"  # run a single test
```

### Docker

```bash
docker compose up --build          # start all services (dbv, mongodb, keycloak)
docker compose up --build dbv      # rebuild and restart only the app container
docker compose down -v             # stop and remove volumes
```

## Configuration (Environment Variables)

All runtime configuration is read from environment variables. No secrets in source code.

| Variable | Description |
|---|---|
| `MONGODB_URI` | MongoDB connection string, e.g. `mongodb://mongo:27017` |
| `MONGODB_DB` | Default database name |
| `KEYCLOAK_URL` | Keycloak base URL, e.g. `http://keycloak:8080` |
| `KEYCLOAK_REALM` | Keycloak realm name |
| `KEYCLOAK_CLIENT_ID` | OAuth2 client ID |
| `SERVER_HOST` | Bind host (default `0.0.0.0`) |
| `SERVER_PORT` | Bind port (default `8080`) |
| `FRONTEND_DIST` | Path to React build output (default `./frontend/dist`) |

`config.rs` must parse these at startup using `std::env` or a crate like `envy`/`config`, failing fast with a clear error if required variables are missing.

## Key Conventions

### Error Handling

- Define a single `AppError` enum in `errors.rs` that implements `axum::response::IntoResponse`.
- Route handlers return `Result<impl IntoResponse, AppError>`.
- Use `?` to propagate errors; avoid `.unwrap()` in non-test code.

### Authentication Middleware

- All routes under `/api/` require a valid JWT bearer token except `/api/health`.
- JWT validation uses Keycloak's JWKS endpoint (`<KEYCLOAK_URL>/realms/<REALM>/protocol/openid-connect/certs`).
- Validated claims are injected into handlers via Axum extractors (e.g., a `Claims` extractor).

### MongoDB Access

- A single `mongodb::Client` is created at startup and stored in Axum's `State`.
- Never create per-request clients.
- Collection names and DB names come from config, not hardcoded strings.

### Static File Serving

- The React `dist/` output is served by Axum using `tower-http`'s `ServeDir`.
- All unmatched routes fall back to `index.html` to support client-side routing.
- In development, the React dev server runs separately; in production, Axum serves the built assets.

### Async

- All I/O (MongoDB, HTTP calls to Keycloak) must be `async`/`.await`.
- Do not block the Tokio runtime with synchronous operations; use `tokio::task::spawn_blocking` if needed.

### Docker

- The `Dockerfile` uses multi-stage builds: one stage to compile Rust (using `cargo chef` for layer caching), a minimal final image (e.g., `debian:bookworm-slim` or `gcr.io/distroless/cc`).
- The `docker-compose.yml` defines `dbv`, `mongo`, and `keycloak` services. `dbv` depends on both.
- Secrets and connection strings are passed via `.env` file (gitignored) referenced in `docker-compose.yml`.
