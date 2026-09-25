# Architecture

## Trust boundary

The browser parses and analyzes uploaded CSV/XES logs locally. Raw events are not sent to the investigation endpoint. The server receives a bounded aggregate snapshot, exposes only three typed tools to the model, validates every tool argument and runs a second citation gate before returning text.

This design minimizes disclosure, but a browser-produced aggregate is not cryptographic proof of the original log. The optional PostgreSQL schema supports a future server-verified mode in which event logs, analysis runs and investigation audit steps are persisted per owner.

## Components

| Layer                                | Responsibility                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `shared/process-graph/ingestion.ts`  | CSV/XES normalization, free attributes, deduplication and data-quality report                          |
| `shared/process-graph/discovery.ts`  | DFG statistics, cut-based process tree discovery, holdout alignment and evidence facts                 |
| `shared/process-graph/simulation.ts` | distribution fitting, Poisson arrivals, resource queues, seeded replications and historical validation |
| `server/processGraph.tools.ts`       | allowlisted investigation tools and audit records                                                      |
| `server/processGraph.gate.ts`        | structured-output, citation membership and numeric-claim rejection                                     |
| `client/src/pages/Home.tsx`          | local import, process map, variants, investigation and scenarios                                       |
| `drizzle/schema.ts`                  | PostgreSQL ownership, event, run and audit data model                                                  |

## Determinism

Stable ordering, seeded random streams and data-derived timestamps make the synthetic proof byte-identical. `scripts/generate-proof.ts` is executed twice in CI and the outputs are compared with `cmp`.
