# Threat model

## Protected assets

- customer event logs and free attributes;
- ownership boundaries between logs and analysis runs;
- integrity of evidence IDs and cited values;
- LLM/provider credentials;
- audit history for investigation tools.

## Main threats and controls

| Threat                           | Control                                                                               | Residual risk                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Prompt injection in the question | question is treated as data; tools and JSON schema are fixed                          | a model can still produce weak prose that passes structural validation     |
| Invented numbers                 | model-authored digits/percentages/number words are rejected                           | semantic entailment between prose and citation still needs human review    |
| Arbitrary database access        | model has no SQL/network tool; three allowlisted aggregate tools only                 | browser aggregates are not independently recomputed by the server          |
| XML entity expansion             | DTD/entity declarations are rejected and input is size-bounded                        | regex XES support intentionally covers a conservative subset               |
| Oversized/API abuse              | 1 MB API body limit and per-IP rate window                                            | in-memory limiter is single-instance; production should use a shared store |
| Cross-tenant reads               | PostgreSQL rows carry owner/log foreign keys                                          | repository does not yet expose persistence CRUD routes                     |
| Misleading simulation            | fixed seed, fit diagnostics, 1,000-replication ceiling and historical validation gate | structural/input uncertainty is not fully quantified                       |
