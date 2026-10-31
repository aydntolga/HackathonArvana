# Engineering handoff

## Objective
Build Server Doctor for the Arvana hackathon: continuous HTTP observation followed by a separate reviewer that questions the first agent's conclusions. Protect legitimate users with slow connections, retries, shared NAT, and traffic bursts. Keep the four-hour prototype scope.

## Current implementation
The active system consists of `first-agent.mjs`, `proxy.mjs`, `local-reviewer.mjs`, `telemetry.mjs`, and `server.mjs`. The reviewer combines local rules with a separately fitted contextual novelty model; API integration is deferred. Daily ETL feeds both models through source validation, closed-day splits, calibration and a joint promotion gate. See LEARNING.md. It examines measurements independently and never grants live blocking authority. Earlier `guard.mjs` and `supervisor.mjs` experiments remain independently tested.

The local demo customer website is reached through the observed proxy at port 3001. No real customer integration has been performed. Real customer traffic is a later step requiring an authorized origin and suitable deployment.

The follow-up validation is deliberately sequential: first-agent/proxy tests, independent-reviewer tests, local ETL, then four normal requests to httpbin.org through an isolated proxy. Decision history and hourly review summaries are now available in the dashboard. Baseline checkpoints survive restart for the same upstream, with validation and a 24-hour expiry. See VALIDATION.md for results and limitations.

## Continue work
1. Run npm test and inspect README.md before changing the working implementation.
2. Collect representative benign sessions: slow uploads, client disconnects, server errors, expired authentication, forgotten passwords, shared IP addresses, and legitimate bursts.
3. Define features available at online decision time before selecting or training a model. Do not substitute HTTP metrics for incompatible CICFlowMeter columns.
4. Evaluate by held-out day/session/source, with false-positive rates for each benign cohort, precision, recall, uncertainty, and added p95 latency.
5. Integrate an API-backed reviewer only after provider access is configured. Validate outputs, preserve abstention, and keep the deterministic executor authoritative.

Do not claim that agreeing agents prove correctness, synthetic tests prove accuracy, or this prototype is production DDoS protection. Data ingestion is not automatic labeled learning.
