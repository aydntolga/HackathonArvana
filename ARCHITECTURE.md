# Architecture

Client -> observed HTTP proxy -> fixed upstream

The proxy streams bodies with backpressure. It creates a request lifecycle observation and completes it once on response finish or abort. Request payloads are neither stored nor sent to a model.

## First Agent
Keeps 60 one-second metric buckets, a capped pseudonymous client table, and up to 60 baseline samples. It reports observations and investigation proposals. Aborted responses are not counted as successful completions. A baseline requires warm-up and freezes during obvious unhealthy windows; it is not a learned security model.

## Independent local reviewer
Runs on a bounded five-second cadence outside the HTTP path. It checks freshness and numerical consistency before reviewing server errors, authentication ambiguity, slow lifecycles, and baseline deviations. It independently reads metrics rather than accepting the worker explanation as truth. The bounded history is descriptive, not independent statistical evidence. Actions remain observation-only. Escalation means investigate service health, not block the client.

## Storage and ETL
Minute JSONL snapshots retain aggregate measurements. Daily files use UTC and a seven-day retention limit. A busy writer skips a flush instead of accumulating unbounded work. Storage errors are visible in the dashboard. ETL validates input rows and writes hourly summaries. Tests exercise a real local proxy-to-demo flow through storage and ETL.

## Earlier experiments
`guard.mjs` and `supervisor.mjs` are offline rule experiments with separate unit and synthetic tests. They are not connected to live restrictions. The forgotten-password cohort demonstrates ambiguity: abstaining reduces false restrictions but also leaves indistinguishable brute force unmitigated.

## Future model boundary
Use an online-compatible feature schema, independent evaluation splits, and a constrained reviewer response format. Treat all request-derived content as untrusted. A model must not receive unrestricted firewall credentials. Missing evidence, model errors, and disagreements must not silently become blocking decisions.
