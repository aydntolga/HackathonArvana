# Validation record — 2026-10-31

Validation was performed in order: First Agent and proxy, independent local reviewer, local telemetry/ETL, then a bounded public-API integration check.

## Automated tests

`node --test`: **33 passed, 0 failed**. Coverage includes successful slow responses, disconnected clients, unavailable upstreams, bounded memory, invalid reviewer evidence, worker vetoes, missed worker evidence, baseline restart/expiry/source isolation, and matching review records in ETL. JavaScript syntax and Git whitespace checks passed.

Two baseline defects were found and fixed: empty windows were accepted as healthy samples, and polling across a wall-clock minute could double-count nearly identical windows. New regression tests reproduce both conditions.

## Public API integration

Target: https://httpbin.org/ — a public HTTP request/response testing service.
Command: `npm run validate:external`.

| Scenario | Expected status | Observed status | Observed request duration |
| --- | --- | --- | --- |
| GET /get | 200 | 200 | 993 ms |
| POST /post with a small synthetic JSON body | 200 | 200 | 183 ms |
| GET /delay/1 | 200 | 200 | 1,159 ms |
| GET /status/503 | 503 | 503 | 192 ms |

All four requests passed through the project's local proxy to the real HTTPS service. The agent recorded four completions and no transport-level upstream failures. The local reviewer abstained because four requests do not meet its minimum evidence threshold. One matching reviewed snapshot reached the hourly ETL report. No client was blocked. Requests were sequential with a one-second pause, without automatic retries. Echoed response bodies were discarded.

## Interpretation

This verifies functional request handling, decision plumbing and ETL, not classifier accuracy, false-positive rates, internet-speed identification, attack detection quality, or load capacity. Timings include the local proxy and external network and are not controlled latency benchmarks. The declared HTTP 503 is an intentional test response, not an attack.

The current reviewer is a deterministic local policy, not a trained AI model. Real customer integration, labeled held-out evaluations, and model/API integration remain future work.
