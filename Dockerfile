# ── Stage 1: compute recipe for dependency caching ──────────────────────────
FROM rust:1-slim-bookworm AS chef
RUN cargo install cargo-chef --locked
WORKDIR /app

FROM chef AS planner
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo chef prepare --recipe-path recipe.json

# ── Stage 2: build dependencies (cached layer) ───────────────────────────────
FROM chef AS builder-deps
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json

# ── Stage 3: build the application ───────────────────────────────────────────
FROM builder-deps AS builder
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --bin dbv

# ── Stage 4: build the React frontend ────────────────────────────────────────
FROM node:24-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

# ── Stage 5: minimal runtime image ───────────────────────────────────────────
FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/dbv ./dbv
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

ENV FRONTEND_DIST=/app/frontend/dist
ENV SERVER_HOST=0.0.0.0
ENV SERVER_PORT=8080

EXPOSE 8080
CMD ["./dbv"]
