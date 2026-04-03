# dbv — MongoDB Browser

A browser-based MongoDB viewer and editor secured with Keycloak OAuth2/JWT authentication. Runs entirely in Docker.

## Table of Contents

- [User Guide](#user-guide)
  - [Getting Started](#getting-started)
  - [First-Time Keycloak Setup](#first-time-keycloak-setup)
  - [Using the App](#using-the-app)
  - [Roles and Permissions](#roles-and-permissions)
- [Developer Guide](#developer-guide)
  - [Architecture](#architecture)
  - [Prerequisites](#prerequisites)
  - [Local Development](#local-development)
  - [Project Structure](#project-structure)
  - [Environment Variables](#environment-variables)
  - [API Reference](#api-reference)

---

## User Guide

### Getting Started

**Requirements:** Docker and Docker Compose.

**1. Clone and configure**

```bash
git clone <repo-url>
cd dbv
cp .env.example .env
# Edit .env and set a secure KEYCLOAK_ADMIN_PASSWORD
```

**2. Add local hostnames** *(local development only)*

```bash
echo '127.0.0.1  dbv.localhost keycloak.localhost' | sudo tee -a /etc/hosts
```

**3. Start all services**

```bash
docker compose up -d
```

This starts four containers:

| Service | Purpose |
|---|---|
| **traefik** | HTTPS reverse proxy, routes traffic |
| **dbv** | The application (Rust + React) |
| **mongo** | MongoDB database |
| **keycloak** | Authentication server |

**4. Open the app**

| URL | Description |
|---|---|
| `https://dbv.localhost` | dbv application |
| `https://keycloak.localhost` | Keycloak admin console |
| `http://localhost:8888` | Traefik dashboard (internal) |

> **Note:** Your browser will show a security warning for the self-signed certificate in local development. Accept it to proceed. In production, configure Let's Encrypt (see [Environment Variables](#environment-variables)).

---

### First-Time Keycloak Setup

Before you can log in to dbv, you need to create a user in Keycloak and assign them a role.

**1. Open the Keycloak admin console**

Go to `https://keycloak.localhost` and sign in with the credentials from your `.env` file (default: `admin` / `admin`).

**2. Create roles**

1. In the left menu, go to **Realm roles**
2. Click **Create role**
3. Enter `dbv-admin` (full access) or `dbv-viewer` (read-only)
4. Click **Save** — repeat for the other role if needed

**3. Create a user**

1. Go to **Users** → **Add user**
2. Fill in **Username** and click **Create**
3. Go to the **Credentials** tab → **Set password** → disable **Temporary**
4. Go to the **Role mapping** tab → **Assign role** → select `dbv-admin` or `dbv-viewer`

**4. Create a client** *(for token issuance)*

1. Go to **Clients** → **Create client**
2. Set **Client ID** to the value of `KEYCLOAK_CLIENT_ID` in your `.env` (default: `dbv`)
3. Enable **Direct access grants**
4. Set **Valid redirect URIs** to `https://dbv.localhost/*`
5. Click **Save**

---

### Using the App

**Signing in**

Open `https://dbv.localhost`. Enter your Keycloak **username** and **password** and click **Sign In**. The app will obtain and silently refresh tokens automatically — you will not be asked to log in again until the Keycloak SSO session expires (default: 10 hours).

**Managing databases**

- The left sidebar shows a **Database** dropdown listing all available databases.
- *(admin only)* Click **＋** next to "Database" to create a new database. MongoDB requires an initial collection name — the database is created along with it.
- *(admin only)* Click **🗑** next to the selected database to drop it permanently. System databases (`admin`, `config`, `local`) are protected and cannot be dropped.

**Managing collections**

- After selecting a database, its collections appear in the sidebar below.
- *(admin only)* Click **＋** next to "Collection" to create a new collection.
- *(admin only)* Click **✕** on any collection to drop it and all its documents.

**Document view**

- Browse documents with configurable **pagination** (10 / 20 / 50 / 100 per page)
- **Filter** documents using a full MongoDB query expression:
  - Simple match: `{"status": "active"}`
  - Comparison: `{"price": {"$gt": 20.00}}`
  - Array operator: `{"tags": {"$in": ["sale", "new"]}}`
  - Combined: `{"age": {"$gte": 18}, "country": "DE"}`
- **Sort** by any field: `{"price": -1}` (descending) or `{"name": 1}` (ascending)
- Filter and Sort fields validate JSON in real time — blue border when active, red on invalid; Apply is disabled when JSON is invalid
- Press **Enter** or **Apply** to run; **Clear** resets both Filter and Sort
- The Documents tab badge shows the total matching count

**Editing documents** *(dbv-admin only)*

- **+ New** — opens a JSON editor to create a new document
- **Edit** — opens the document in a JSON editor with syntax highlighting
- **Delete** — permanently removes the document after confirmation

**Aggregate**

Run an aggregation pipeline against the selected collection:

```json
[
  { "$match": { "status": "active" } },
  { "$group": { "_id": "$category", "count": { "$sum": 1 } } }
]
```

**Schema**

Inspect the inferred schema of a collection — sampled from up to 100 documents. Shows:

| Column | Description |
|---|---|
| **Field path** | Dotted path, including nested fields (e.g. `address.city`) |
| **Types** | All BSON types observed for that field |
| **Coverage** | Percentage of sampled documents that contain this field |
| **Nullable** | Whether any document had `null` for this field |

**Indexes**

View, create, and drop indexes on a collection from the **Indexes** tab:

- The table shows name, key fields and directions, unique/sparse flags, and TTL
- **+ New Index** opens the index builder: add key fields (ascending `1` or descending `-1`), set optional name, Unique, Sparse, and TTL (seconds)
- Click **Drop** to delete an index (`_id_` is protected and cannot be dropped)

**Export / Import** *(import requires dbv-admin)*

- **Export** — downloads the entire collection as a pretty-printed JSON file
- **Import** — uploads a JSON file (array of documents); you will be asked whether to replace the existing data

---

### Roles and Permissions

| Action | `dbv-viewer` | `dbv-admin` |
|---|:---:|:---:|
| Browse databases and collections | ✅ | ✅ |
| Read documents (with filter / sort / pagination) | ✅ | ✅ |
| Run aggregation pipelines | ✅ | ✅ |
| View collection schema | ✅ | ✅ |
| View indexes | ✅ | ✅ |
| Export collection to JSON | ✅ | ✅ |
| Create database | ❌ | ✅ |
| Drop database | ❌ | ✅ |
| Create collection | ❌ | ✅ |
| Drop collection | ❌ | ✅ |
| Create document | ❌ | ✅ |
| Edit document | ❌ | ✅ |
| Delete document | ❌ | ✅ |
| Import JSON into collection | ❌ | ✅ |
| Create index | ❌ | ✅ |
| Drop index | ❌ | ✅ |

---

## Developer Guide

### Architecture

```
Browser (HTTPS)
  └── Traefik v3  (TLS termination, HTTP→HTTPS redirect)
        ├── https://dbv.localhost        → dbv:8080
        └── https://keycloak.localhost   → keycloak:8080

dbv container
  ├── Axum (Rust)  serves /api/* and static files
  │     ├── auth/        JWT RS256 validation via Keycloak JWKS
  │     ├── rbac/        ReadAccess / WriteAccess Axum extractors
  │     ├── routes/      auth proxy, CRUD, aggregate, schema, export/import
  │     └── db/          MongoDB 2.8 async client
  └── React SPA    served from frontend/dist/
```

### Prerequisites

| Tool | Version |
|---|---|
| Rust | stable (1.75+) |
| Node.js | 18+ |
| Docker + Docker Compose | v2 |

### Local Development

**1. Start infrastructure only**

```bash
docker compose up -d traefik mongo keycloak
```

**2. Run the Rust backend**

```bash
cp .env.example .env
# Edit .env — set MONGODB_URI=mongodb://localhost:27017 and expose mongo port if needed
export $(grep -v '^#' .env | xargs)
cargo run
# Server on http://localhost:8080
```

> For local dev it is simpler to use `docker compose up -d` for all services and iterate only on the frontend with `npm run dev`.

**3. Run the React frontend dev server**

```bash
cd frontend
npm install
npm run dev
# Opens http://localhost:5173
# /api requests are proxied to http://localhost:8080 automatically
```

**4. Build for production**

```bash
cd frontend && npm run build && cd ..
cargo build --release
```

### Project Structure

```
src/
├── main.rs           # Axum router, server startup
├── config.rs         # Env-var config (envy crate) — fails fast on missing vars
├── state.rs          # AppState + FromRef impls for sub-extractors
├── errors.rs         # AppError enum implementing IntoResponse
├── auth/
│   ├── mod.rs        # JwksCache, Claims extractor, RS256 JWT validation
│   └── rbac.rs       # ReadAccess / WriteAccess extractors
├── db/
│   └── mod.rs        # DbClient — wraps mongodb::Client, pings on startup
└── routes/
    ├── auth_proxy.rs # POST /api/auth/login and /api/auth/refresh (Keycloak proxy)
    ├── health.rs     # GET /api/health  (no auth, pings MongoDB)
    ├── data.rs       # CRUD, aggregate, pagination, create/drop DB & collection
    ├── schema.rs     # Schema inference (samples 100 docs, infers BSON types)
    └── transfer.rs   # Export (GET) and Import (POST)

frontend/src/
├── api/
│   ├── client.ts        # axios instance — Bearer token + silent refresh on 401
│   └── mongo.ts         # typed API functions for all endpoints
├── context/
│   └── AuthContext.tsx  # token storage, auto-refresh timer, role parsing
├── components/
│   ├── ProtectedRoute.tsx
│   └── SchemaViewer.tsx
└── pages/
    ├── LoginPage.tsx    # Username/password login form
    └── BrowserPage.tsx  # Main UI: sidebar, documents, aggregate, schema
```

### Environment Variables

All backend configuration is read from environment variables at startup. Missing required variables cause an immediate exit with a clear error message.

| Variable | Required | Default | Description |
|---|:---:|---|---|
| `MONGODB_URI` | ✅ | — | MongoDB connection string |
| `MONGODB_DB` | ✅ | — | Default database name |
| `KEYCLOAK_URL` | ✅ | — | Keycloak base URL (internal, e.g. `http://keycloak:8080`) |
| `KEYCLOAK_REALM` | ✅ | — | Keycloak realm |
| `KEYCLOAK_CLIENT_ID` | ✅ | — | OAuth2 client ID |
| `SERVER_HOST` | | `0.0.0.0` | Bind address |
| `SERVER_PORT` | | `8080` | Bind port |
| `FRONTEND_DIST` | | `./frontend/dist` | Path to built React assets |
| `DBV_HOST` | | `dbv.localhost` | Public hostname (Traefik routing) |
| `KEYCLOAK_PUBLIC_HOST` | | `keycloak.localhost` | Keycloak public hostname (Traefik routing) |
| `TLS_RESOLVER` | | *(blank)* | Traefik cert resolver. Leave blank for self-signed; set `letsencrypt` for production |
| `ACME_EMAIL` | | `admin@example.com` | Email for Let's Encrypt (production only) |

### API Reference

All endpoints are under `/api`.

#### Authentication *(no token required)*

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/api/auth/login` | `{ "username": "…", "password": "…" }` | Password-grant login via Keycloak. Returns `access_token`, `refresh_token`, `expires_in`. |
| POST | `/api/auth/refresh` | `{ "refresh_token": "…" }` | Exchange a refresh token for a new token pair. |

#### Health *(no token required)*

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Liveness check, pings MongoDB |

#### Databases & Collections

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/databases` | viewer+ | List all databases |
| POST | `/api/databases/:db` | admin | Create database with body `{ "collection": "name" }` |
| DELETE | `/api/databases/:db` | admin | Drop database (system databases blocked) |
| GET | `/api/databases/:db/collections` | viewer+ | List collections in a database |
| POST | `/api/databases/:db/collections` | admin | Create collection with body `{ "name": "…" }` |
| DELETE | `/api/databases/:db/collections/:col` | admin | Drop collection and all its documents |

#### Documents

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/databases/:db/collections/:col/documents` | viewer+ | List documents. Query params: `page`, `limit`, `filter` (JSON), `sort` (JSON) |
| POST | `/api/databases/:db/collections/:col/documents` | admin | Insert a document |
| GET | `/api/databases/:db/collections/:col/documents/:id` | viewer+ | Get document by ObjectId |
| PUT | `/api/databases/:db/collections/:col/documents/:id` | admin | Replace document by ObjectId |
| DELETE | `/api/databases/:db/collections/:col/documents/:id` | admin | Delete document by ObjectId |

#### Aggregation & Schema

| Method | Path | Role | Body | Description |
|---|---|---|---|---|
| POST | `/api/databases/:db/collections/:col/aggregate` | viewer+ | `{ "pipeline": [...] }` | Run aggregation pipeline |
| GET | `/api/databases/:db/collections/:col/schema` | viewer+ | — | Infer schema from up to 100 sampled documents |

#### Indexes

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/databases/:db/collections/:col/indexes` | viewer+ | List all indexes |
| POST | `/api/databases/:db/collections/:col/indexes` | admin | Create index. Body: `{ "keys": {"field": 1}, "name": "...", "unique": true, "sparse": false, "ttl": 3600 }` |
| DELETE | `/api/databases/:db/collections/:col/indexes/:name` | admin | Drop index by name (`_id_` blocked) |

#### Export / Import

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/databases/:db/collections/:col/export` | viewer+ | Download collection as JSON |
| POST | `/api/databases/:db/collections/:col/import` | admin | Import `{ "documents": [...], "replace": false }` |

### Adding a New Route

1. Add handler function in `src/routes/<feature>.rs` — use `ReadAccess` or `WriteAccess` extractor as appropriate
2. Register the route in `src/main.rs` inside the `api` router
3. Add the corresponding typed function in `frontend/src/api/mongo.ts`
4. Add `pub mod <feature>;` to `src/routes/mod.rs`

### Production Deployment

1. Point real DNS records for `DBV_HOST` and `KEYCLOAK_PUBLIC_HOST` to your server
2. In `.env`, set:
   ```
   TLS_RESOLVER=letsencrypt
   ACME_EMAIL=you@yourdomain.com
   DBV_HOST=dbv.yourdomain.com
   KEYCLOAK_PUBLIC_HOST=auth.yourdomain.com
   KEYCLOAK_ADMIN_PASSWORD=<strong-password>
   ```
3. `docker compose up -d` — Traefik will obtain certificates automatically on first request

