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
│   ├── db/mod.rs         # DbClient — wraps mongodb::Client, stores URI + TLS overrides,
│   │                    #   from_uri_with_tls(), masked_uri(), run_command helper.
│   │                    #   Wrapped in Arc<RwLock<>> in AppState for runtime swapping.
│   └── routes/
│       ├── health.rs     # GET /api/health
│       ├── data.rs       # CRUD + aggregate + stats + run_command
│       ├── schema.rs     # GET schema — samples docs, infers field types
│       ├── transfer.rs   # GET export, POST import
│       ├── connection.rs # GET /api/connection, POST /api/connection,
│       │                 #   POST /api/connection/reconnect
│       └── openapi.rs    # GET /docs (Swagger UI), GET /api/openapi.yaml
├── frontend/
│   ├── src/
│   │   ├── api/          # client.ts (axios + auth interceptor), mongo.ts
│   │   ├── context/      # AuthContext (token + roles + canWrite)
│   │   ├── utils/
│   │   │   ├── mongoSchema.ts  # JSON Schema builders for Monaco autocomplete
│   │   │   └── bsonFormat.ts   # Shared BSON Extended JSON display utilities
│   │   ├── components/   # ProtectedRoute, SchemaViewer, DocTreeView,
│   │   │                 #   DocFormEditor, CollectionView, CommandsView
│   │   └── pages/        # LoginPage, BrowserPage (sidebar + tab management)
│   ├── vite.config.ts    # Proxy /api → http://localhost:8080 for dev
│   └── dist/             # Production build (served by Axum)
├── Dockerfile            # Multi-stage: cargo-chef + Node builder + debian runtime
├── docker-compose.yml
├── kubernetes/
│   └── helm/dbv/         # Helm chart for Kubernetes deployment
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

- `DbClient` is stored in `AppState` as `Arc<tokio::sync::RwLock<DbClient>>`. All route handlers acquire a read lock: `let db = state.db.read().await;`. The connection management routes acquire a write lock only during reconnect/swap.
- Never create per-request clients.
- `DbClient` stores: the `mongodb::Client`, `default_db: String`, `uri: String`, and TLS override fields (`tls_ca_file`, `tls_cert_key_file`, `tls_allow_invalid_certs`).
- `DbClient::from_uri_with_tls(uri, default_db, ca, cert_key, allow_invalid)` is the canonical constructor; `from_uri(uri, default_db)` and `new(&config)` delegate to it.
- `DbClient::masked_uri()` replaces the password in the URI with `***` for display.
- Collection names and DB names come from request path params, not hardcoded strings.
- The schema endpoint samples up to 100 documents to infer field paths and BSON types.
- `DbClient::run_command(db, doc, admin)` runs arbitrary commands; pass `admin: true` to target the `admin` database.

### Monaco Editor and Autocomplete

- The app uses `@monaco-editor/react ^4.7` for all JSON editors (filter, sort, projection, document, aggregate, command).
- Each editor is given a unique `path` prop that matches a JSON Schema registered via `loader.init().then(monaco => monaco.languages.json.jsonDefaults.setDiagnosticsOptions({...}))`.
- Schemas are rebuilt and re-registered whenever the active collection's schema changes (keyed on the `schema` state via `useEffect` inside `CollectionView.tsx`).
- Schema builders live in `frontend/src/utils/mongoSchema.ts`:
  - `buildDocumentSchema(schema)` → properties from sampled fields
  - `buildFilterSchema(schema)` → fields + MongoDB query operators (`$eq`, `$gt`, `$in`, `$regex`, `$elemMatch`, …) + logical operators
  - `buildSortSchema(schema)` → fields with `enum: [1, -1]`
  - `buildProjectionSchema(schema)` → fields with `enum: [0, 1]`, plus explicit `_id` entry
  - `PIPELINE_SCHEMA` → static schema for all aggregation stage names
- Editor paths and their matching schema URIs:

  | Editor | path | schema URI |
  |---|---|---|
  | Filter | `dbv://filter` | `http://dbv/filter-schema.json` |
  | Sort | `dbv://sort` | `http://dbv/sort-schema.json` |
  | Projection | `dbv://projection` | `http://dbv/projection-schema.json` |
  | Document create/edit | `dbv://document` | `http://dbv/document-schema.json` |
  | Aggregate pipeline | `dbv://pipeline` | `http://dbv/pipeline-schema.json` |
  | Command runner | `dbv://command` | *(no schema registered — free-form)* |

- To add autocomplete to a new Monaco editor: assign it a unique `path`, create a JSON Schema, and add it to the `schemas` array in the `useEffect` inside `CollectionView.tsx`.

### Document Form Editor (`DocFormEditor.tsx`)

A schema-driven form component used alongside the Monaco JSON editor in the document edit/create modal.

- Receives `schema: CollectionSchema | null`, `value: string` (JSON), `onChange`, `isEditing` props.
- Parses the JSON document and renders one input per top-level field based on its dominant BSON type:

  | Type | Widget |
  |---|---|
  | `date` | Separate `<input type="date">` + `<input type="time">` operating in **UTC**. Stored as `{"$date": "ISO"}`. |
  | `bool` | True / False radio buttons inside a dark container. |
  | `int` / `double` | `<input type="number">` |
  | `long` | Number input → `{"$numberLong": "..."}` |
  | `decimal` | Number input → `{"$numberDecimal": "..."}` |
  | `objectId` | Text input → `{"$oid": "..."}` |
  | `string` | `<input type="text">` |
  | `object` / `array` / mixed | JSON textarea |

- `_id` is read-only when `isEditing` is true.
- Schema fields **and** extra doc fields both show a **×** remove button (except `_id`).
- "Add field" section at the bottom lets users append new fields with a type selector.
- The collection schema is fetched automatically when the editor modal opens (no need to visit the Schema tab).
- Switching between Form and JSON modes is non-destructive: both share the same `editorValue` string.
- The `CollectionView` modal header shows a **Form | JSON** pill toggle (`editorMode` state, defaults to `"form"`).

### Connection Management

- `AppState.db` is `Arc<RwLock<DbClient>>`. All standard handlers use `state.db.read().await`; only the connection routes acquire a write lock.
- **Reconnect flow**: read current `uri` + TLS fields without the lock, call `DbClient::from_uri_with_tls` (potentially slow, no lock held), then take write lock and swap.
- `routes/connection.rs`:
  - `GET /api/connection` — pings MongoDB, returns `{ uri (masked), default_db, status, error?, tls_ca_file?, tls_cert_key_file?, tls_allow_invalid_certs }`. No auth required.
  - `POST /api/connection` — body `{ uri, default_db?, tls_ca_file?, tls_cert_key_file?, tls_allow_invalid_certs? }`. Creates client without holding the lock; returns 400 on failure. Requires `ReadAccess`.
  - `POST /api/connection/reconnect` — re-creates client from stored URI + TLS settings. Requires `ReadAccess`.
- Frontend (`BrowserPage.tsx`):
  - `connInfo: ConnectionInfo | null` state loaded on mount via `getConnection()`.
  - Status strip in sidebar: coloured dot + masked URI + **↻ Reconnect** + **⚙ Change** buttons.
  - "Change Connection" modal pre-fills all fields from `connInfo`; passes TLS fields to `setConnection(params)`.
  - `reloadDatabases` only calls `logout()` / redirects on HTTP 401; MongoDB errors show in the error banner instead.

### Multi-Tab Architecture

- `BrowserPage` manages a `tabs: Tab[]` array (`{ id, db, col }`) and `activeTabId`.
- Clicking a collection in the sidebar calls `openCollection(db, col)` which always creates a new tab (no deduplication). Multiple tabs for the same `db/col` are allowed.
- Each `CollectionView` instance is always mounted (never unmounted on tab switch); `display: none` is used to hide inactive tabs, preserving all their React state.
- Tab labels: collection name; `db/col` if the same collection name exists in multiple databases; `col (N)` suffix (1-based) when multiple tabs point to the same db+col.
- Dropping a database or collection from the sidebar closes any open tabs referencing it.
- `BrowserPage` owns only: sidebar state, tab array, DB/collection management modals, DB stats modal.
- All per-collection state (filter, sort, projection, pagination, view mode, documents, schema, indexes, stats, pipeline, editor modals) lives inside `CollectionView`.

### BSON Extended JSON

- All document writes (create, update, filter, sort, aggregate pipeline) pass through `json_to_doc()` in `data.rs`, which uses `bson::Bson::try_from(value)` (Extended JSON deserialiser) rather than `bson::to_document()` (serde serialiser). This correctly converts `$date`, `$oid`, `$binary`, `$numberLong`, `$numberDecimal`, etc.
- `_id` resolution: `parse_id_bson(id: &str)` in `data.rs` tries `ObjectId::parse_str` first (24 hex chars) then falls back to `Bson::String`. Both single-document and bulk operations use this helper.
- BSON serialisation output: `bson v2`'s serde `Serialize` emits **canonical** Extended JSON — dates become `{"$date": {"$numberLong": "ms"}}`. All display code must handle this form.
- Display utilities live in `frontend/src/utils/bsonFormat.ts`:
  - `formatBsonValue(v)` — converts any Extended JSON value to a readable string (handles both canonical and relaxed date forms, ObjectId, UUID, Long, Decimal, etc.)
  - `isBsonPrimitive(v)` — returns true if the value should be displayed inline (not as a nested object)
  - `bsonTypeColor(v)` / `bsonTypeLabel(v)` — type badge utilities used by DocTreeView
- Import and use `formatBsonValue` everywhere BSON values are rendered to the UI (table preview cells, tree view node labels, etc.)

### Authentication Token Handling

- JWT bearer tokens use base64url encoding (no padding, `-`/`_` instead of `+`/`/`). The frontend's `base64urlDecode()` in `AuthContext.tsx` adds padding and substitutes characters before `atob()`.
- `msUntilRefresh` enforces a **10-second minimum** delay to prevent tight refresh loops caused by Docker clock skew (tokens appearing already-expired).
- The `login` function is wrapped in `useCallback([scheduleRefresh])` and the context value in `useMemo` to prevent unnecessary consumer re-renders.

- `POST /api/databases/:db/run_command` with body `{ "command": {...}, "admin": bool }` runs any MongoDB command.
- Requires `WriteAccess` (dbv-admin only).
- When `admin: true` the command is routed to the `admin` database regardless of `:db`.
- Frontend: `CommandsView.tsx` — left palette selects a template; right side has Monaco editor, admin toggle, Run button, and read-only result viewer.
- `loadDocumentsRef` pattern: use `useRef` to keep `onMount` callbacks stable when calling parent state-modifying functions from Monaco event handlers. The ref lives in `CollectionView.tsx`.

### Static File Serving

- The React `dist/` output is served by Axum using `tower-http`'s `ServeDir`.
- All unmatched routes fall back to `index.html` to support client-side routing.
- In development, run `npm run dev` in `frontend/` — Vite proxies `/api` to `localhost:8080`.

### OpenAPI / Swagger UI

- The OpenAPI 3.0 spec lives at `src/openapi.yaml` and is embedded into the binary at compile time via `include_str!`.
- Two routes are served outside the `/api` namespace (no JWT required):
  - `GET /docs` — Swagger UI (Swagger UI 5, loaded from CDN; topbar hidden; `persistAuthorization: true`)
  - `GET /api/openapi.yaml` — raw YAML spec
- Handlers live in `src/routes/openapi.rs` (`swagger_ui`, `openapi_spec`).
- To test authenticated endpoints in Swagger UI: call `POST /api/auth/login`, copy the `access_token`, click **Authorize**, paste the token (Swagger UI prepends `Bearer ` automatically).
- When adding or changing routes, update `src/openapi.yaml` to keep the spec in sync.

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

### Helm / Kubernetes

- The Helm chart at `kubernetes/helm/dbv/` deploys only the **dbv** container. MongoDB and Keycloak are assumed to exist in-cluster or externally.
- `MONGODB_URI` is stored in a `Secret` (created from `config.mongodbUri` or from an existing secret via `existingSecret`).
- All other env vars are in a `ConfigMap` (Keycloak URL/realm/clientId, MongoDB DB name, optional TLS paths).
- The `Deployment` uses `checksum/config` and `checksum/secret` pod annotations so that config changes automatically trigger a rollout.
- Liveness and readiness probes both hit `GET /api/health`.
- The `Ingress` resource supports any ingress class and cert-manager TLS annotations.
- `HorizontalPodAutoscaler` is included but disabled by default (`autoscaling.enabled: false`).
- Lint with: `helm lint ./kubernetes/helm/dbv --set config.mongodbUri=x --set config.keycloakUrl=x --set config.keycloakRealm=x --set config.keycloakClientId=x`
