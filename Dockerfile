# syntax=docker/dockerfile:1.7

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
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo chef cook --release --locked --recipe-path recipe.json

# ── Stage 3: build the application ───────────────────────────────────────────
FROM builder-deps AS builder
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo build --release --locked --bin dbv && \
    strip target/release/dbv

# ── Stage 4: build the React frontend ────────────────────────────────────────
FROM node:24-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY frontend ./
RUN npm run build

# ── Stage 5: minimal runtime image ───────────────────────────────────────────
FROM gcr.io/distroless/cc-debian12:nonroot AS runtime
WORKDIR /app
COPY --from=builder /app/target/release/dbv ./dbv
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

LABEL org.opencontainers.image.authors="Danny Janssen" \
      org.opencontainers.image.vendor="dannys-janssen" \
      org.opencontainers.image.title="dbv" \
      org.opencontainers.image.documentation="https://github.com/dannys-janssen/dbv#readme" \
      org.opencontainers.image.source="https://github.com/dannys-janssen/dbv" \
      org.opencontainers.image.description="Browser-based MongoDB viewer and editor secured with Keycloak OAuth2/JWT authentication." \
      org.opencontainers.image.licenses="MIT"

ENV FRONTEND_DIST=/app/frontend/dist
ENV SERVER_HOST=0.0.0.0
ENV SERVER_PORT=8080

EXPOSE 8080
CMD ["/app/dbv"]
