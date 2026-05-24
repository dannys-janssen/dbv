# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| `main` | Yes |
| Latest release | Yes |
| Older releases | No |

## Reporting a vulnerability

Please do **not** open public GitHub issues for suspected security vulnerabilities.

Use GitHub's private vulnerability reporting flow for this repository:

1. Open the repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Include the affected area, impact, reproduction steps, version or commit, and any relevant configuration details.

If private vulnerability reporting is not available, contact the maintainer privately through GitHub instead of posting details publicly.

Please avoid sending secrets, production credentials, or personal data in your report unless they are strictly required to reproduce the issue.

## What to expect

- Reports will be acknowledged as soon as reasonably possible.
- Valid reports will be investigated and triaged privately.
- Fixes will be released as soon as a safe remediation is ready.
- Public disclosure should wait until a fix or mitigation is available and coordinated.

## Scope

This policy covers the code and deployment assets in this repository, including:

- the Rust backend and React frontend
- Docker and Compose configuration
- Helm chart and Kubernetes manifests
- published container images built from this repository
