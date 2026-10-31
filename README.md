# Server Doctor

A four-hour hackathon prototype for continuous HTTP health monitoring and independently reviewed risk decisions.

## Run

Requires Node.js 22 or newer. No npm dependencies are required.

```sh
npm run dev
```

- Dashboard: http://localhost:3000
- Observed demo customer website: http://localhost:3001
- Demo origin (bypasses observation): http://localhost:3002

Open the customer website and use its normal, slow-response, server-error, and failed-login examples. These generate real requests against the local demo only. The dashboard displays measurements and the local reviewer's independent assessment.

To observe your application, copy `.env.example` to `.env` and set `TARGET_URL` to a fixed HTTP or HTTPS origin. Direct client traffic to port 3001. When TARGET_URL is configured, the built-in demo origin is disabled. All listeners bind to loopback. This repository does not deploy anything publicly.

## Two stages

1. **First Agent** observes streaming requests, open requests, completion status, aborts, byte counts, and approximate p95 lifecycle time. It maintains a 60-second window and a bounded baseline of recent healthy windows. Empty windows and failed-login traffic do not train the healthy baseline, and samples must be at least 60 seconds apart.
2. **Local Reviewer** independently checks numeric consistency, freshness, server failures, ambiguous authentication, slow users, and legitimate demand. It can veto a worker recommendation, flag evidence the worker missed, and ask for more evidence. It runs outside the request path and keeps a bounded decision timeline visible in the dashboard.

Both stages currently use deterministic policies. There is no trained classifier, LLM, API key, or measured production accuracy. The live proxy is observation-only. Existing `guard.mjs` and `supervisor.mjs` are separate earlier policy experiments, not live enforcement.

## Telemetry and ETL

Minute snapshots and matching reviewer decisions are appended to `data/telemetry/YYYY-MM-DD.jsonl` (UTC), with seven-day retention. Bodies, cookies, credentials, raw IP addresses, and query strings are not stored. Client identities use a process-local keyed hash. Disk failures are reported without blocking traffic.

```sh
npm run etl
npm test
```

ETL produces hourly summaries of available snapshots and review verdicts, not exact request totals or unique incident counts. It rejects reviews that do not match their source snapshot. The dashboard shows the last generated report. No operating-system schedule is installed. Tests cover the agent, proxy, reviewer, storage, and ETL, including a real local HTTP flow.

### Final integration step: a public test API

After local tests pass, run `npm run validate:external`. It sends exactly four normal requests through an isolated local proxy to [httpbin.org](https://httpbin.org/): GET, a small POST, a delayed response, and a declared 503 response. Requests are sequential, with a one-second pause and no retries. The check stores aggregate telemetry, the review, and an ETL report under the ignored `data/external-validation/` directory. It does not perform a load test, replay attacks, or save echoed response bodies. Public service availability can make this optional check fail; it is not part of `npm test`.

## Dataset

The official CSE-CIC-IDS2018 capture day contains 1,048,575 records: 996,077 benign, 41,508 GoldenEye, and 10,990 Slowloris. Large CSVs are not included in Git. To download and profile the source file, use Python 3.11+:

```sh
python download_dataset.py
```

`data/manifest.json` records the source, label counts, file size, citation, and SHA-256. Network-flow features differ from HTTP telemetry; this dataset has not been used to train the live agent. A single day is not sufficient for independent training, validation, and testing. See DATASETS.md.

## Limits

- Slow connections and retries are not sufficient evidence of malicious intent.
- Failed-password retry loops can look identical to brute force; the reviewer abstains rather than claiming certainty.
- Successful-request floods, network-layer DDoS, and Slowloris socket behavior are not comprehensively detected.
- WebSocket and CONNECT tunnels return 501. HTTP/2, HTTP/3, TCP/UDP monitoring, and TLS termination are outside this prototype.
- Header timeout is 60 seconds; request and upstream idle timeouts are 120 seconds. Long uploads need different settings.
- Lifecycle duration includes client and upstream delays; it does not measure client internet speed directly.
- Baselines checkpoint to ignored `data/baseline.json` and restore only for the same upstream. Corrupt, expired (over 24 hours), or incompatible checkpoints trigger fresh warm-up. A partial checkpoint from an interrupted write is rejected. Gradual baseline poisoning is not solved. Overlapping observation windows are not independent statistical samples.
- The client estimate is capped at 2,000 identities; evictions reduce identity precision while aggregate counters continue.

See ARCHITECTURE.md and HANDOFF.md for the implementation and next steps.
