# Measurement contract and results

## What is measured

The two local learned novelty models are evaluated as **operational incident candidates**, not malicious-user classifiers. A positive label means a generated server-error or transport-degradation scenario. Negative cohorts are ordinary traffic, slow successful clients, legitimate campaigns and legitimate login retries. The upper agent's final rule-assisted escalation decision is measured separately from its learned model.

Run `npm run measure:models`. This performs two actual file-based ETL transfers: 2,000 and 2,500 generated telemetry rows. All 4,500 rows are validated and serialized. The first transfer supplies training references. The first 500 rows of the second supply calibration references; its remaining 2,000 rows are untouched test data. Different seeds and disjoint IDs separate partitions. Target labels and cohort names are removed before inference. Model parameters are saved and reloaded before scoring.

These are synthetic replay windows with simulated chronological event timestamps, **not customer observations collected over previous days**. This isolated test workflow does not bypass the production closed-day gate or promote test weights into the main application. Daily production scheduling is unchanged. The interface displays completed test learning separately from deployment readiness.

## Results

Training references: 1,703. Calibration references: 430. Held-out test: 2,000, consisting of 1,000 incident and 1,000 healthy windows. The remaining validated training/calibration rows do not meet the operational reference filter; they are not malformed records.

| Metric | First learned model | Upper learned model |
| --- | ---: | ---: |
| Accuracy | 93.30% (1,866/2,000) | 85.75% (1,715/2,000) |
| Precision | 98.54% (879/892) | 87.20% (838/961) |
| Incident recall | 87.90% (879/1,000) | 83.80% (838/1,000) |
| Healthy false-alarm rate | 1.30% (13/1,000) | 12.30% (123/1,000) |
| Missed incident windows | 121 | 162 |
| Accuracy, illustrative 95% Wilson interval | 92.12–94.31% | 84.15–87.21% |

The upper model flagged 123 of 140 legitimate login-retry windows as novel. Both models missed some lower-intensity transport degradation. These findings are actionable weaknesses, not reasons to suppress unfavorable results. No threshold was changed after inspecting these test outcomes.

The final reviewer policy obtained 2,000/2,000 escalation agreement in this generated suite. It includes deterministic health rules, and the synthetic labels overlap with those rules; that result must not be presented as 100% learned-model accuracy. The separate actual HTTP lab obtained 8/8 scenario escalation agreement across 1,645 requests, including one local overload detected in 1.134 seconds. That run tested the rule-enabled agents and integration path, not trained-model production generalization.

## Release targets

Before autonomous production restrictions, require at least 95% incident recall, at most 1% healthy false alarms, and detection p95 below five seconds on representative, independently labeled customer episodes. These are proposed acceptance criteria, not guarantees. Neither standalone learned model currently meets the recall and false-alarm targets in the synthetic test. The single HTTP incident supplies one latency observation, not a p95 benchmark. Production remains observation-only.

Accuracy is `(TP + TN) / total`; precision is `TP / (TP + FP)`; recall is `TP / (TP + FN)`; false-alarm rate is `FP / (FP + TN)`. Synthetic prevalence is 50% incidents and does not represent customer prevalence. Wilson intervals assume independent observations; shared generator families and scripted traffic limit that interpretation. A final unseen real-customer holdout is still required after development improvements.

## Product surfaces

- Internal console: http://localhost:3000 — interactive traffic plot, customer scatterplot, response mix, two-layer timeline, confusion matrix, model metrics, uncertainty intervals and completed two-transfer learning.
- Product website: http://localhost:3003 — separate presentation server, no telemetry or model APIs.
- Lab: http://localhost:3010 when `npm run lab` is running.

The presentation website's route allowlist rejects internal API and data paths. All listeners bind to loopback. This local separation is not a multi-user authentication system; do not expose the internal console through a public tunnel.

## Reproducibility

Ignored `data/measurement/` contains `protocol.json`, both transferred JSONL files, `test-model-pair.json`, and `report.json`. Seeds and feature-generation rules are fixed. Run timestamps and artifact hashes vary; scores are deterministic. `npm test` validates partition separation, transfer counts, metrics, model persistence, existing behavior, and website/API separation.

Customer positioning: “Server Doctor is an observation-first monitoring prototype with independent review and a measured local evaluation pipeline. It highlights service concerns while keeping ambiguity visible. Production enforcement requires a labeled customer pilot against agreed recall and false-alarm targets.”
