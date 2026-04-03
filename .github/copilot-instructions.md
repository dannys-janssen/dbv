# Copilot Instructions

## Project Overview

**dbv** is a Rust-based web application that provides a browser UI for viewing and editing MongoDB data and structure. It runs as a Docker container alongside MongoDB, Keycloak, and Traefik, orchestrated via `docker-compose`.

## Architecture

```
browser (HTTPS)
  └── Traefik (TLS termination, HTTP→HTTPS redirect)
        └── dbv container :8080
              ├── React SPA (static assets via tower-http ServeDir)
              └── /api/* (Axum REST handlers)
                    ├── MongoDB (mongodb 2.8, separate container)
                    └── Keycloak (JWKS JWT validation, separate container)
```

- **Backend**: Rust, Axum 0.7, Tokio async runtime, mongodb 2.8
- **Frontend**: React + TypeScript, Vite, served as static files by Axum; proxied to `localhost:8080` during dev via Vite proxy
- **Auth**: Keycloak OIDC; backend validates RS256 JWT bearer tokens; JWKS fetched and cached from Keycloak
- **RBAC**: Two roles — `dbv-admin` (read + write) and `dbv-viewer` (read-only); enforced via `ReadAccess`/`WriteAccess` Axum extractors in `src/auth/rbac.rs`
- **TLS**: Traefik v3 terminates TLS. Local dev uses Traefik's built-in self-signed cert (`TLS_RESOLVER` blank). Production: set `TLS_RESOLVER=letsencrypt` and `ACME_EMAIL`
- **Deployment**: `docker-compose.yml` — `traefik`, `dbv`, `mongo:7`, `keycloak:25`

### Directory Layout

```
/
├── src/
│   ├── main.rs           # Axum router setup, server startup
│   ├── config.rs         # Env-var config via envy
│   ├── state.rs          # AppState + FromRef impls
│   ├── errors.rs         # AppError enum → IntoResponse
│   ├── auth/
│   │   ├── mod.rs        # JwksCache, Claims extractor, JWT RS256 validation
│   │   └── rbac.rs       # ReadAccess / WriteAccess extractors
│   ├── db/mod.rs         # DbClient (MongoDB wrapper, ping on startup, run_command helper)
│   └── routes/
│       ├── health.rs     # GET /api/health
│       ├── data.rs       # CRUD + aggregate + stats + run_command
│       ├── schema.rs     # GET schema — samples docs, infers field types
│       └── transfer.rs   # GET export, POST import
├── frontend/
│   ├── src/
│   │   ├── api/          # client.ts (axios + auth interceptor), mongo.ts
│   │   ├── context/      # AuthContext (token + roles + canWrite)
│   │   ├── utils/
│   │   │   └── mongoSchema.ts  # JSON Schema builders for Monaco autocomplete
│   │   ├── components/   # ProtectedRoute, SchemaViewer, DocTreeView, CommandsView
│   │   └── pages/        # LoginPage, BrowserPage (all tabs)
│   ├── vite.config.ts    # Proxy /api → http://localhost:8080 for dev
│   └── dist/             # Production build (served by Axum)
├── Dockerfile            # Multi-stage: cargo-chef + Node builder + debian runtime
├── docker-compose.yml
└── .env.example
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
npm run dev          # local dev server (proxies /api → localhost:8080)
npm test             # run tests
npm test -- --testNamePattern="<name>"  # run a single test
```

### Docker

```bash
docker compose up --build          # start all services (traefik, dbv, mongo, keycloak)
docker compose up --build dbv      # rebuild and restart only the app container
docker compose down -v             # stop and remove volumes
```

**Local dev hostnames** — add to `/etc/hosts`:
```
127.0.0.1  dbv.localhost keycloak.localhost
```
Then access `https://dbv.localhost` (browser will warn about self-signed cert unless you trust Traefik's CA).

Traefik dashboard: `http://localhost:8888`

## Configuration (Environment Variables)

All runtime configuration is read from environment variables. No secrets in source code.

| Variable | Description |
|---|---|
| `MONGODB_URI` | MongoDB connection string, e.g. `mongodb://mongo:27017` (supports auth, replica sets, Atlas SRV, TLS params) |
| `MONGODB_DB` | Default database name |
| `KEYCLOAK_URL` | Keycloak base URL, e.g. `http://keycloak:8080` |
| `KEYCLOAK_REALM` | Keycloak realm name |
| `KEYCLOAK_CLIENT_ID` | OAuth2 client ID |
| `SERVER_HOST` | Bind host (default `0.0.0.0`) |
| `SERVER_PORT` | Bind port (default `8080`) |
| `FRONTEND_DIST` | Path to React build output (default `./frontend/dist`) |
| `DBV_HOST` | Public hostname for Traefik routing (default `dbv.localhost`) |
| `KEYCLOAK_PUBLIC_HOST` | Public hostname for Keycloak via Traefik (default `keycloak.localhost`) |
| `TLS_RESOLVER` | Traefik cert resolver. Leave blank for self-signed; `letsencrypt` for production |
| `ACME_EMAIL` | Email for Let's Encrypt (production only) |
| `MONGODB_TLS_CA_FILE` | Path to PEM CA cert for custom/private CA |
| `MONGODB_TLS_CERT_KEY_FILE` | Path to PEM client cert+key for mutual TLS |
| `MONGODB_TLS_ALLOW_INVALID_CERTS` | `true` to skip cert validation (dev only) |

`config.rs` parses backend vars at startup using `envy`, failing fast with a clear error if required variables are missing.

## Key Conventions

### Error Handling

- Define a single `AppError` enum in `errors.rs` that implements `axum::response::IntoResponse`.
- Route handlers return `Result<impl IntoResponse, AppError>`.
- Use `?` to propagate errors; avoid `.unwrap()` in non-test code.

### Role-Based Access Control

- Roles are read from the JWT's `realm_access.roles` claim (set in Keycloak).
- `dbv-viewer` role → `ReadAccess` extractor passes.
- `dbv-admin` role → both `ReadAccess` and `WriteAccess` extractors pass.
- Read handlers (list, get, export, aggregate, schema, stats) use `ReadAccess`.
- Write handlers (create, update, delete, import, run_command) use `WriteAccess`.
- The frontend reads roles from the JWT payload client-side to hide write controls for viewers.

### Authentication Middleware

- All routes under `/api/` require a valid JWT bearer token except `/api/health`.
- JWT validation uses Keycloak's JWKS endpoint (`<KEYCLOAK_URL>/realms/<REALM>/protocol/openid-connect/certs`).
- JWKS keys are cached in `JwksCache`; on unknown `kid`, the cache refreshes once before failing.
- Validated claims are injected into handlers via Axum extractors (`Claims`, `ReadAccess`, `WriteAccess`).

### MongoDB Access

- A single `mongodb::Client` is created at startup and stored in Axum's `State`.
- Never create per-request clients.
- Collection names and DB names come from request path params, not hardcoded strings.
- The schema endpoint samples up to 100 documents to infer field paths and BSON types.
- `DbClient::run_command(db, doc, admin)` runs arbitrary commands; pass `admin: true` to target the `admin` database.

### Monaco Editor and Autocomplete

- The app uses `@monaco-editor/react ^4.7` for all JSON editors (filter, sort, document, aggregate, command).
- Each editor is given a unique `path` prop that matches a JSON Schema registered via `loader.init().then(monaco => monaco.languages.json.jsonDefaults.setDiagnosticsOptions({...}))`.
- Schemas are rebuilt and re-registered whenever the active collection's schema changes (keyed on the `schema` state via `useEffect`).
- Schema builders live in `frontend/src/utils/mongoSchema.ts`:
  - `buildDocumentSchema(schema)` → properties from sampled fields
  - `buildFilterSchema(schema)` → fields + MongoDB query operators (`$eq`, `$gt`, `$in`, `$regex`, `$elemMatch`, …) + logical operators
  - `buildSortSchema(schema)` → fields with `enum: [1, -1]`
  - `PIPELINE_SCHEMA` → static schema for all aggregation stage names
- Editor paths and their matching schema URIs:

  | Editor | path | schema URI |
  |---|---|---|
  | Filter | `dbv://filter` | `http://dbv/filter-schema.json` |
  | Sort | `dbv://sort` | `http://dbv/sort-schema.json` |
  | Document create/edit | `dbv://document` | `http://dbv/document-schema.json` |
  | Aggregate pipeline | `dbv://pipeline` | `http://dbv/pipeline-schema.json` |
  | Command runner | `dbv://command` | *(no schema registered — free-form)* |

- To add autocomplete to a new Monaco editor: assign it a unique `path`, create a JSON Schema, and add it to the `schemas` array in the `useEffect` inside `BrowserPage.tsx`.

### Command Runner

- `POST /api/databases/:db/run_command` with body `{ "command": {...}, "admin": bool }` runs any MongoDB command.
- Requires `WriteAccess` (dbv-admin only).
- When `admin: true` the command is routed to the `admin` database regardless of `:db`.
- Frontend: `CommandsView.tsx` — left palette selects a template; right side has Monaco editor, admin toggle, Run button, and read-only result viewer.
- `loadDocumentsRef` pattern: use `useRef` to keep `onMount` callbacks stable when calling parent state-modifying functions from Monaco event handlers.

### Static File Serving

- The React `dist/` output is served by Axum using `tower-http`'s `ServeDir`.
- All unmatched routes fall back to `index.html` to support client-side routing.
- In development, run `npm run dev` in `frontend/` — Vite proxies `/api` to `localhost:8080`.

### Async

- All I/O (MongoDB, HTTP calls to Keycloak) must be `async`/`.await`.
- Do not block the Tokio runtime with synchronous operations; use `tokio::task::spawn_blocking` if needed.

### Traefik / TLS

- Services do **not** publish ports directly (except Traefik 80/443/8888). All HTTP traffic routes through Traefik.
- TLS router labels are on each service. When `TLS_RESOLVER` is empty, Traefik uses its built-in self-signed cert.
- For production: set `TLS_RESOLVER=letsencrypt`, `ACME_EMAIL`, and real public hostnames in `.env`.

### Docker

- The `Dockerfile` uses multi-stage builds: `cargo-chef` for Rust dependency layer caching, a Node stage for the React build, and a minimal `debian:bookworm-slim` runtime image.
- The `docker-compose.yml` defines four services: `traefik`, `dbv`, `mongo`, `keycloak`. `dbv` depends on `mongo` and `keycloak` via healthchecks.
- Secrets and connection strings are passed via `.env` file (gitignored) referenced in `docker-compose.yml`.
