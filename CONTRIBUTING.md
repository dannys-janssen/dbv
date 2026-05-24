# Contributing to dbv

Thanks for contributing to `dbv`.

This guide covers the expected workflow for code, documentation, and release-related changes in this repository.

## Before you start

- For setup and architecture details, start with the [README](README.md).
- For security issues, do **not** open a public issue. Use private vulnerability reporting instead.
- Keep changes focused. Separate unrelated fixes or features into separate pull requests when possible.

## Development setup

### Prerequisites

- Rust stable
- Node.js 24+
- Docker Compose v2

### Local development

1. Copy `.env.example` to `.env` and adjust values as needed.
2. Start dependencies with Docker:

   ```bash
   docker compose up -d traefik mongo keycloak
   ```

3. Run the backend:

   ```bash
   export $(grep -v '^#' .env | xargs)
   cargo run
   ```

4. Run the frontend in another terminal:

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

For the full local-development flow, hostnames, and deployment options, see the [README](README.md).

## Implementation guidelines

### Backend

- Follow the existing Axum + Tokio patterns already used in `src/`.
- Prefer returning `Result<_, AppError>` from handlers and propagate errors with `?`.
- Avoid `unwrap()` in non-test code.
- Keep I/O async and do not add blocking work on the Tokio runtime.
- Update `src/openapi.yaml` whenever you add or change API routes.

### Frontend

- Follow the existing React + TypeScript patterns in `frontend/src/`.
- Add translation keys to `frontend/src/locales/en.json` for new UI text.
- Keep new interactive UI accessible: keyboard operable, labelled, and aligned with the repo's ARIA patterns.
- Reuse existing utilities and shared components before introducing new patterns.

### Documentation

- Update `README.md` when user-facing behaviour, setup, or workflows change.
- Add focused docs next to the feature or workflow they describe instead of duplicating existing guidance.

## Validation

Run the checks that match the area you changed before opening a pull request.

### Backend

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-features
```

### Frontend

```bash
cd frontend
npm ci
npm run build
npm test -- --watch=false
```

### Docker

For changes that affect integration, startup, or deployment behaviour:

```bash
docker compose up --build
```

## Pull requests

- Base pull requests on `main`.
- Use a focused branch for each change.
- Fill out the pull request template completely.
- Summarize the user-visible impact and list the important code or docs changes.
- Include screenshots or recordings for UI changes when they help reviewers.
- Mention any follow-up work, limitations, or breaking changes clearly.

Before requesting review, confirm that the PR checklist items apply and are addressed:

- code follows the existing style
- OpenAPI is updated for API changes
- translation keys are added for new UI text
- new interactive UI is accessible
- README updates are included when behaviour changes

## Release-related changes

- Merge version-bump or release-prep commits into `main` before creating a release tag.
- Do not create a release tag from a topic branch.
- Before publishing a tag, verify that the tagged commit is reachable from `origin/main`.
