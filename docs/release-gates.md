# Release gates

`main` is releasable only when every gate below is green. The CI workflow runs the same commands on Node 20 and 22.

| Gate                | Command                       | Blocking condition                                                            |
| ------------------- | ----------------------------- | ----------------------------------------------------------------------------- |
| Formatting          | `pnpm format:check`           | Any tracked source differs from Prettier output                               |
| Types               | `pnpm check`                  | Any TypeScript error                                                          |
| Tests + coverage    | `pnpm test:coverage`          | Any failure or coverage below 85% lines/functions/statements and 75% branches |
| Production build    | `pnpm build`                  | Client or server bundle fails                                                 |
| Runtime smoke       | `pnpm smoke`                  | Health, SPA entry point or fallback route fails in the production server      |
| Reproducibility     | proof generated twice + `cmp` | Any byte differs for fixed log, version and seed                              |
| Dependencies        | `pnpm security`               | High or critical production advisory                                          |
| Simulation validity | runtime validation gate       | Baseline absolute percentage error exceeds configured tolerance               |
| Evidence integrity  | citation/tool gate            | Unknown ID, unsupported number, malformed output or out-of-scope tool call    |

The deterministic proof artifact is a synthetic control. It demonstrates repeatability; it is not customer evidence or a benchmark against a real ERP.
