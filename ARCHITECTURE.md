# Architecture

Client -> observed HTTP proxy -> fixed upstream

The proxy streams bodies with backpressure. It creates a request lifecycle observation and completes it once on response finish or abort. Request payloads are neither stored nor sent to a model.

## First Agent
Keeps 60 one-second metric buckets, a capped pseudonymous client table, and up to 60 baseline samples. It reports observations and investigation proposals. Aborted responses are not counted as successful completions. Baseline sampling requires at least 20 completions, 95% success, no authentication failures, upstream failures or aborts, and at least 60 elapsed seconds since the last attempt. Empty traffic is not a healthy training sample. Validated checkpoints preserve the baseline for the same upstream for up to 24 hours; this is not a learned security model.

## Independent local reviewer
Runs on a bounded five-second cadence outside the HTTP path. It checks freshness, status totals, histogram totals, request-rate consistency and baseline metadata before reviewing server errors, authentication ambiguity, slow lifecycles, and baseline deviations. It independently reads metrics rather than accepting the worker explanation as truth. A bounded timeline records state changes and minute checkpoints, including worker vetoes and missed evidence. History is descriptive, not independent statistical evidence. Actions remain observation-only. Escalation means investigate service health, not block the client.

## Storage and ETL
Minute JSONL snapshots retain aggregate measurements and a fresh review of the exact same snapshot. Daily files use UTC and a eight-day retention limit. A busy writer skips a flush instead of accumulating unbounded work. Storage errors are visible in the dashboard. ETL validates input rows and review/source alignment, then writes hourly summaries of verdicts, worker vetoes and missed evidence. Counts refer to sampled windows, not unique incidents. Tests exercise a real local proxy-to-demo flow through storage and ETL; a separate opt-in script checks four normal requests against httpbin.org.

## Earlier experiments
`guard.mjs` and `supervisor.mjs` are offline rule experiments with separate unit and synthetic tests. They are not connected to live restrictions. The forgotten-password cohort demonstrates ambiguity: abstaining reduces false restrictions but also leaves indistinguishable brute force unmitigated.

## Daily learned models

`daily-learning.mjs` builds a shared source-specific dataset from validated, non-overlapping closed-day windows. `local-models.mjs` fits separate robust-distance and nearest-reference models, with chronological calibration and holdout gates. Both layers use the same persisted model pair and expose independent evidence. See LEARNING.md for requirements, limitations, scheduling and rollback.

## Future model boundary
Use an online-compatible feature schema, independent evaluation splits, and a constrained reviewer response format. Treat all request-derived content as untrusted. A model must not receive unrestricted firewall credentials. Missing evidence, model errors, and disagreements must not silently become blocking decisions.
