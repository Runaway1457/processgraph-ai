# Security policy

## Reporting

Do not open a public issue for a vulnerability that could expose event logs, credentials or tenant data. Report it privately to the repository owner with the affected version, reproduction steps, impact and a minimal proof of concept.

## Supported version

Security fixes target the latest commit on `main`. This research-grade release does not promise long-term support for older tags.

## Deployment requirements

- use unique secrets and a minimum 32-character `JWT_SECRET`;
- keep `LLM_API_KEY` server-side;
- terminate TLS before the application;
- replace the in-memory rate limiter with a shared store in multi-instance deployments;
- configure retention, deletion and backup policies before persisting customer logs;
- validate authentication and ownership boundaries in the target environment;
- run `pnpm security` and the complete `pnpm qa` gate before release.

The complete analysis of assets, threats, controls and residual risks is in [docs/threat-model.md](docs/threat-model.md).
