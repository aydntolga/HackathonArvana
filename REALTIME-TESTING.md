# Real-time customer lab

Run `npm run lab` to start eight independent fictional customer websites, an observation proxy per customer, and a live dashboard at http://localhost:3010. The default run uses real sockets, actual responses, wall-clock time, and the production FirstAgent, LocalReviewer, telemetry and ETL modules. It does not fabricate detector input rows or backdate training data.

`npm run test:realtime` runs the same acceptance scenario and exits. `npm test` includes fast capacity and target-boundary checks, but not the two-minute acceptance scenario.

## Customers

| Customer | Traffic profile |
| --- | --- |
| Harbor Store | Normal product browsing |
| Morning News | Normal feed requests |
| Atlas Docs | Higher-frequency documentation requests |
| City Booking | Reservation POST requests |
| Rural Connect | Successful responses delayed six seconds; latency ambiguity |
| Member Portal | Repeated 401 responses mixed with successful browsing |
| Launch Store | Healthy flash crowd during the burst phase |
| Small Ticket Office | Local overload during the burst phase |

Each website is clickable from the dashboard. URLs use ephemeral loopback ports so the sites do not collide with the main project server. Each customer has separate agents, telemetry directories, upstream identity and model registry. Customer/scenario labels are used by the test evaluator only; they are not features supplied to either agent.

## Scenario and limits

1. 25 seconds of normal traffic.
2. 25 seconds of increased traffic against both Launch Store and Small Ticket Office, with the same offered cadence (at most approximately 16 requests/second each).
3. 65 seconds of normal traffic to allow the agents' 60-second windows to recover.

Small Ticket Office permits two concurrent API operations, each taking 250 ms; excess requests receive 503 from its real HTTP handler. Launch Store serves the same offered burst without that bottleneck. This produces an observable service degradation rather than inserting a hardcoded attack label. Generator limits are eight in-flight requests and 1,200 requests per customer, a ten-second client timeout, and literal `127.0.0.1` HTTP targets only. Redirects are rejected. No external target parameter is accepted.

This is a bounded **single-host HTTP overload simulation**, not a distributed DDoS attack. A service-health alert identifies the symptoms; it does not prove attacker intent or distinguish a hostile flood from every legitimate overload. The slow-response site exercises long lifecycle handling, not a true network bandwidth emulator.

## ETL and evaluation

Every five seconds the lab persists a source-tagged snapshot with a fresh independent review and rebuilds each customer's hourly ETL report. The dashboard shows both live decisions and reviewed ETL counts. At completion, persisted rows are replayed through an independent reviewer using their original measurement timestamps; no scenario label is passed to the reviewer. Daily learning also runs against each customer's isolated store.

Acceptance checks require: all eight customers present; all generated requests completed without transport failures; no health escalations on the seven healthy workloads; no restrictions; worker and reviewer detection on the overloaded customer; the same incident found in persisted replay; recovery; valid reviewed ETL records; and source isolation.

Reports and JSONL files are stored under ignored `data/realtime-lab/<run-id>/<customer>/`; the aggregate report is `data/realtime-lab/<run-id>/report.json`. Report labels are ground truth about the generated scenario only. Counts are observed scenario outcomes, not production accuracy metrics. Five-second snapshots overlap; daily learning deduplicates and separates them by at least 60 seconds.

The two-minute run cannot train a three-day model. Models explicitly remain `insufficient-data`; existing rule-based decisions are evaluated live. Learned-model fitting and rollback are covered by the separate synthetic learning tests. No lab fixture is promoted into the main application's model store. With `npm run lab`, generated traffic stops after the bounded scenario, but websites, manual HTTP observation, ETL and daily scheduling remain active until the process stops. Each new invocation starts an isolated run.

These are simulated customers, not connected third-party traffic feeds. Fetching a public website does not reveal its visitors' request logs. Real customer traffic requires routing an authorized application through the proxy or providing its authorized request telemetry. The existing optional `npm run validate:external` performs four ordinary httpbin requests and is separate from this load scenario.
