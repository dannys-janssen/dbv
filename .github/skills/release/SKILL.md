---
name: release
description: >
  Creates a new versioned release for the dbv project. Use this skill when asked to
  "cut a release", "bump the version", "create a new release", "release vX.Y.Z", or
  "tag a release". It bumps versions across all relevant files, updates the README,
  publishes a GitHub wiki release-notes page, opens a pull request against main, and
  after the PR is merged it creates and pushes the git tag that triggers Docker publishing.
allowed-tools: shell
---

# dbv Release Skill

Follow these steps exactly whenever you are asked to create a new release.

## 1. Determine the new version

- If the user specifies a version (e.g. "release v0.3.0"), use that.
- Otherwise, read the current version from `Cargo.toml` (`version = "X.Y.Z"`) and increment the **patch** segment by default, or the **minor** or **major** segment if the user requests it.
- The version string must always be bare semver without a leading `v` in files (e.g. `0.3.0`), but branch names and tags use the `v` prefix (e.g. `v0.3.0`).

## 2. Confirm with the user

Before making any changes, print a summary:

```
New version : v<VERSION>
Branch      : release/v<VERSION>
Files to update:
  - Cargo.toml
  - Cargo.lock  (via cargo build)
  - kubernetes/helm/dbv/Chart.yaml
  - src/openapi.yaml
  - README.md  (release section)
Wiki page   : Release notes for v<VERSION>
PR target   : main
```

Ask the user to confirm before proceeding.

## 3. Create the release branch

```bash
git checkout main
git pull origin main
git checkout -b release/v<VERSION>
```

## 4. Bump versions in all files

### 4a. `Cargo.toml`

Find the line `version = "OLD"` in the `[package]` section and replace it with `version = "NEW"`.

Use `sed` to do this precisely — only the first occurrence (the `[package]` version, not dependency versions):

```bash
sed -i '' "0,/^version = \"[^\"]*\"/{s/^version = \"[^\"]*\"/version = \"<VERSION>\"/}" Cargo.toml
```

Verify: `grep '^version' Cargo.toml` should show `version = "<VERSION>"`.

### 4b. `Cargo.lock`

Run `cargo build --release` (or `cargo build`) to regenerate `Cargo.lock` with the new version. This is required — do not edit `Cargo.lock` manually.

### 4c. `kubernetes/helm/dbv/Chart.yaml`

Replace both `version:` and `appVersion:` fields:

```bash
sed -i '' "s/^version: .*/version: <VERSION>/" kubernetes/helm/dbv/Chart.yaml
sed -i '' "s/^appVersion: .*/appVersion: \"<VERSION>\"/" kubernetes/helm/dbv/Chart.yaml
```

Verify: `grep -E '^(version|appVersion)' kubernetes/helm/dbv/Chart.yaml`

### 4d. `src/openapi.yaml`

Replace the `version:` field inside the `info:` block (line that reads `  version: "OLD"`):

```bash
sed -i '' "s/^  version: \"[^\"]*\"/  version: \"<VERSION>\"/" src/openapi.yaml
```

Verify: `grep '  version:' src/openapi.yaml`

### 4e. `README.md`

Locate the `#### Releasing a new version` section. Update the example tag commands to use the new version:

```bash
sed -i '' "s/git tag v[0-9][^ ]*/git tag v<VERSION>/g" README.md
```

Also update any inline version badge or reference to the previous version number if present:
```bash
OLD_VERSION=$(git show main:Cargo.toml | grep '^version' | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
sed -i '' "s/${OLD_VERSION}/<VERSION>/g" README.md
```

## 5. Run validation

Run all checks and fix any failures before committing:

```bash
cargo fmt --all --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-features
cd frontend && npm test -- --watch=false && npm run build && cd ..
helm lint ./kubernetes/helm/dbv \
  --set config.mongodbUri=x \
  --set config.keycloakUrl=x \
  --set config.keycloakRealm=x \
  --set config.keycloakClientId=x
```

If any step fails, fix the issue and re-run that step before proceeding.

## 6. Commit the version bump

```bash
git add Cargo.toml Cargo.lock kubernetes/helm/dbv/Chart.yaml src/openapi.yaml README.md
git commit -m "chore: release v<VERSION>

- bump Cargo.toml to <VERSION>
- update Helm chart version and appVersion to <VERSION>
- update OpenAPI spec version to <VERSION>
- update README release section

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## 7. Push the branch

```bash
git push -u origin release/v<VERSION>
```

## 8. Create the GitHub wiki release-notes page

Use the GitHub CLI to push a release-notes wiki page. The wiki is a separate git repository at `https://github.com/<OWNER>/<REPO>.wiki.git`.

### 8a. Gather the changelog

Fetch the commit log since the last tag to build release notes:

```bash
LAST_TAG=$(git describe --tags --abbrev=0 HEAD~1 2>/dev/null || echo "")
if [ -n "$LAST_TAG" ]; then
  CHANGES=$(git --no-pager log "${LAST_TAG}..HEAD" --oneline --no-merges | head -40)
else
  CHANGES=$(git --no-pager log --oneline --no-merges | head -40)
fi
```

Also fetch merged PR titles since the last tag:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
LAST_TAG_DATE=$(git log -1 --format=%aI "$LAST_TAG" 2>/dev/null || echo "")
if [ -n "$LAST_TAG_DATE" ]; then
  PR_LIST=$(gh pr list --repo "$REPO" --state merged --search "merged:>=${LAST_TAG_DATE}" --json number,title,author --jq '.[] | "* #\(.number) \(.title) by @\(.author.login)"' | head -30)
else
  PR_LIST=""
fi
```

### 8b. Clone the wiki and add the page

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
WIKI_DIR=$(mktemp -d)
git clone "https://github.com/${REPO}.wiki.git" "$WIKI_DIR" 2>/dev/null || {
  # Wiki has no pages yet — init it
  mkdir -p "$WIKI_DIR"
  cd "$WIKI_DIR"
  git init
  git remote add origin "https://github.com/${REPO}.wiki.git"
}

cd "$WIKI_DIR"

# Write the release notes page
cat > "Release-v<VERSION>.md" << 'EOF'
# Release v<VERSION>

**Released:** $(date '+%Y-%m-%d')

## What's Changed

${PR_LIST:-No pull requests listed.}

## Commits

\`\`\`
${CHANGES}
\`\`\`

## Docker Image

```
docker pull ghcr.io/<OWNER>/dbv:v<VERSION>
docker pull ghcr.io/<OWNER>/dbv:<VERSION>
docker pull ghcr.io/<OWNER>/dbv:latest
```

## Upgrade

Update your `docker-compose.yml` or Helm `values.yaml` to reference the new version tag.

### Docker Compose

```yaml
image: ghcr.io/<OWNER>/dbv:<VERSION>
```

### Helm

```bash
helm upgrade dbv ./kubernetes/helm/dbv --set image.tag=<VERSION>
```

## Full Changelog

https://github.com/<OWNER>/dbv/compare/<LAST_TAG>...v<VERSION>
EOF

git add "Release-v<VERSION>.md"
git commit -m "Add release notes for v<VERSION>"
git push origin HEAD:master 2>/dev/null || git push origin HEAD:main
cd -
rm -rf "$WIKI_DIR"
```

> Note: If wiki push fails due to authentication, instruct the user to create the wiki page manually at `https://github.com/<OWNER>/dbv/wiki/new` using the content above.

## 9. Open the pull request

```bash
gh pr create \
  --base main \
  --head "release/v<VERSION>" \
  --title "Release v<VERSION>" \
  --body "## Summary

- Bump Rust package version to \`<VERSION>\`
- Update Helm chart version and appVersion to \`<VERSION>\`
- Update embedded OpenAPI spec version to \`<VERSION>\`
- Update README release section

## Wiki

Release notes published to the [project wiki](https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/wiki/Release-v<VERSION>).

## Validation

- \`cargo fmt --all --check\`
- \`cargo clippy --all-targets --all-features -- -D warnings\`
- \`cargo test --all-features\`
- \`cd frontend && npm test -- --watch=false\`
- \`cd frontend && npm run build\`
- \`helm lint ./kubernetes/helm/dbv ...\`

## After Merge

Once this PR is merged into \`main\`, invoke this skill again with \`tag v<VERSION>\` to create and push the release tag, which triggers Docker image publishing."
```

## 10. Tag the release

After the PR is merged (or if the user asks you to tag an already-merged release), run
the tagging step. **Do not tag before the PR is merged into main.**

### 10a. Check if the tag already exists

```bash
VERSION="<VERSION>"   # bare semver, e.g. 0.3.0
TAG="v${VERSION}"

# Check remote tags
if git ls-remote --tags origin "refs/tags/${TAG}" | grep -q "${TAG}"; then
  echo "Tag ${TAG} already exists on origin — nothing to do."
  exit 0
fi

# Check local tags
if git tag --list "${TAG}" | grep -q "${TAG}"; then
  echo "Tag ${TAG} exists locally but not yet pushed — will push it."
  git push origin "${TAG}"
  exit 0
fi
```

### 10b. Verify the PR is merged and the commit is on main

```bash
# Confirm the release branch was merged
PR_STATE=$(gh pr list --repo "$(gh repo view --json nameWithOwner -q .nameWithOwner)" \
  --head "release/${TAG}" --state merged --json state --jq '.[0].state // "not_found"')

if [ "$PR_STATE" != "MERGED" ]; then
  echo "ERROR: release/${TAG} has not been merged into main yet."
  echo "Merge the PR first, then run the tag step."
  exit 1
fi

# Pull latest main and verify the version in Cargo.toml matches
git checkout main
git pull origin main
CURRENT_VER=$(grep '^version' Cargo.toml | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')

if [ "$CURRENT_VER" != "${VERSION}" ]; then
  echo "ERROR: Cargo.toml on main shows ${CURRENT_VER}, expected ${VERSION}."
  echo "Ensure the correct release PR has been merged before tagging."
  exit 1
fi
```

### 10c. Create and push the tag

```bash
git tag -a "${TAG}" -m "Release ${TAG}"
git push origin "${TAG}"
echo "Tag ${TAG} pushed — Docker workflow will publish ghcr.io/<OWNER>/dbv:${TAG}"
```

### 10d. Verify the tag was accepted

```bash
git ls-remote --tags origin "refs/tags/${TAG}"
```

If the output is empty the push failed — retry or ask the user to push manually.

## 11. Report back

Print a full summary:

```
✅ Version bumped to v<VERSION>
✅ Branch: release/v<VERSION>
✅ Files updated: Cargo.toml, Cargo.lock, Chart.yaml, openapi.yaml, README.md
✅ Wiki page created: Release-v<VERSION>
✅ PR opened: <PR_URL>
✅ Tag v<VERSION> pushed → Docker build triggered

Docker images will be published at:
  ghcr.io/<OWNER>/dbv:v<VERSION>
  ghcr.io/<OWNER>/dbv:<VERSION>
  ghcr.io/<OWNER>/dbv:<MAJOR>.<MINOR>
  ghcr.io/<OWNER>/dbv:<MAJOR>
  ghcr.io/<OWNER>/dbv:latest
```
