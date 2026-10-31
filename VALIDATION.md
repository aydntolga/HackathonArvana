# Validation record — 2026-10-31

Validation was performed in order: First Agent and proxy, independent local reviewer, local telemetry/ETL, then a bounded public-API integration check.

## Automated tests

`node --test`: **51 passed, 0 failed**. Coverage includes successful slow responses, disconnected clients, unavailable upstreams, bounded memory, invalid reviewer evidence, worker vetoes, missed worker evidence, baseline restart/expiry/source isolation, matching review records in ETL, and local customer capacity/traffic boundaries. JavaScript syntax and Git whitespace checks passed.

Two baseline defects were found and fixed: empty windows were accepted as healthy samples, and polling across a wall-clock minute could double-count nearly identical windows. New regression tests reproduce both conditions.

## Local real-time acceptance run

Run `1793456159128`: eight fictional customer websites, 1,645 actual HTTP requests, zero transport errors, and 184 matching reviewed ETL snapshots. All nine acceptance checks passed. The overloaded customer produced 167 capacity-related 503 responses; its health incident was detected 1,134 ms after burst start and independently reproduced from persisted telemetry. The alarm cleared after recovery. Seven legitimate workloads produced no reviewer health escalation, including a healthy campaign with 425 requests and a slow-response customer with 114 successful requests. Maximum sampling gap was 1,052 ms.

An earlier run failed acceptance because sampling paused for approximately 100 seconds and requests timed out. It is not counted as a pass. The final run adds a sampling-continuity check and records request error types. These results describe a controlled local single-host overload, not a distributed attack, production detection accuracy or learned-model accuracy. Learned models remained insufficient-data. See REALTIME-TESTING.md.

## Earlier public API integration

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

The reviewer now includes an optional locally fitted contextual novelty model. Ten additional learning tests verify day/source isolation, independent feature views, training-only fitting, promotion/rejection, rollback, locking, artifact integrity and insufficient-data behavior. These use isolated synthetic fixtures. The running application correctly reports insufficient-data because three qualifying closed days are not yet available; no synthetic model was activated on live traffic. The public API results above predate this learning change and were not rerun. Real customer integration, labeled held-out evaluations and API-backed reasoning remain future work.

## Internal analytics and model measurement

The console includes interactive traffic charts, customer and phase filtering, decision timelines, confusion matrices, model comparison, and uncertainty intervals. Two serialized synthetic ETL batches train and evaluate an isolated model pair on 2,000 held-out windows: worker accuracy 93.30%, upper-model accuracy 85.75%. See MEASUREMENT.md for recall, false alarms and limitations. The product website is served separately on port 3003 and rejects internal telemetry API paths. Browser checks verified customer/phase filtering and both product surfaces.
