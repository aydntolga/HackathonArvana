# Daily learning and independent review

The application now includes two locally fitted, unsupervised statistical models alongside its existing safety rules. These are not LLMs or supervised attack classifiers. A novelty score is not an attack probability. Automatic blocking remains disabled.

## Data flow

HTTP proxy → minute telemetry → closed-day ETL → validated shared feature dataset → chronological training/calibration/holdout → two-model quality gate → versioned pair → both live agents.

The First Agent learns robust median/MAD distributions for request rate, active requests, lifecycle latency, server errors and aborts. Its output includes the largest feature deviations.

The independent reviewer learns a bounded nearest-reference model over joint success, authentication, missing-path, error, abort, transport, latency and concurrency features. It recomputes features from measurements, not the worker's score. It reports its three nearest historical reference windows, disagreement with the worker, alternative explanations and missing evidence. Existing health escalation, slow-client abstention and restriction vetoes take precedence over model novelty.

## Daily operation

Starting the server automatically checks for a missed daily run, then checks every minute for UTC date rollover. Failures retry at most hourly. The process must remain running; startup catches up after downtime. `/api/learning` and the dashboard show data quality counts, split sizes, gate results, status and active version. Both layers immediately use the same in-memory pair after successful promotion.

For offline operation, stop the server and run `npm run daily`; use `npm run daily -- --force` to rebuild a completed day. `npm run models:rollback` restores the previous valid pair; restart the server afterwards. A filesystem lock prevents concurrent writers. Daily runs and model reads fail safely without changing traffic handling.

Telemetry carries schema version 1 and a SHA-256 upstream identifier. Legacy rows without source identity are excluded rather than guessed. Eight days of telemetry are retained. Learning considers only closed UTC days within the last eight days; current-day data is never used. Rows must have consistent counts, full 60-second windows and at least 20 completed requests. Duplicate and overlapping windows are excluded. Input files over 16 MiB are skipped and reported.

The most recent closed day is holdout, the preceding day calibration, and earlier days training. At least three days, 120 training windows, 30 calibration windows and 30 holdout windows are required. These are prototype minimums, not evidence of statistical reliability. Scaling and nearest-reference memory are fitted only on training data. Calibration selects distance thresholds; holdout cannot alter fitted parameters.

Reference selection uses raw operational measurements: at least 95% successful, at most 1% server errors, at most 2% authentication failures and aborts, and no transport failures. Slow successful traffic remains eligible. Neither agent's decisions become labels. All valid windows contribute to the dataset hash and quality counts; only the reference cohort fits/calibrates/evaluates the models. Reference traffic is not verified benign and can be contaminated. Real incident labels and representative attack/benign evaluations are still needed.

Both models must flag no more than 10% of their untouched reference holdout before promotion. This is a drift gate, **not accuracy, false-positive rate, or attack recall**. A failed gate retains the old pair. Insufficient data remains explicitly untrained. Expired models (seven days), wrong-source artifacts, invalid parameters and checksum failures fall back to existing rules. Model artifacts and the active/previous registry are written by temporary-file rename; the pair is activated together only after persistence succeeds. Model files are ignored by Git. Checksums detect corruption, not malicious modification by someone with filesystem access.

The CSE-CIC-IDS2018 download remains a separate flow dataset. It is not silently mixed with HTTP-window features. A feature-compatible adapter and independent labeled evaluation would be necessary before it could train these models.

## Validation

`npm test` covers live proxy behavior, independent review, closed-day/source isolation, duplicate rejection, train-only fitting, both model consumers, failed quality gates, insufficient data, artifact tampering and restart loading. Learning fixtures are synthetic and isolated from production artifacts. Test success does not establish production detection accuracy.

The demo website at `http://localhost:3001` exercises real local HTTP traffic. The opt-in `npm run validate:external` script sends four low-rate requests through an isolated proxy to httpbin.org; it tests HTTP/telemetry/ETL transport, not attack detection or model accuracy.
