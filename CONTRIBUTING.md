# Contributing

Changes are welcome when they preserve the project's evidence-first contract.

## Development flow

1. Create a focused branch.
2. Add or update tests before changing a public claim.
3. Run `pnpm qa` locally.
4. Explain the methodological effect, migration impact and residual risk in the pull request.

## Non-negotiable rules

- Never source a displayed number from model-generated prose.
- Every new investigation tool must have a strict schema, an allowlisted implementation and rejection tests.
- Deterministic outputs must use explicit seeds and stable ordering.
- Synthetic and real evidence must remain visibly distinguishable.
- A failed validation remains visible; do not silently suppress or relabel it.
- Changes to discovery or simulation need a known-ground-truth fixture.

Do not commit customer logs, secrets, generated coverage, build output or local databases.
