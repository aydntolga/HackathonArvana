# Data and evaluation plan

## Selected research source: CSE-CIC-IDS2018

Official documentation: https://www.unb.ca/cic/datasets/ids-2018.html
Public bucket: s3://cse-cic-ids2018/ (ca-central-1, unsigned access).
Contains benign traffic, brute force, DoS/DDoS, web attacks and other scenarios; PCAP, logs and CICFlowMeter flow CSVs.
Redistribution requires citation and source link. Cite: Iman Sharafaldin, Arash Habibi Lashkari, Ali A. Ghorbani, “Toward Generating a New Intrusion Detection Dataset and Intrusion Traffic Characterization”, ICISSP 2018.

Do not train on flow CSVs then pretend to infer with HTTP log fields: they are different feature schemas. Full-flow duration and packet counts can also be unavailable at early decision time. A flow classifier needs its own matching online extractor; the current prototype does not have one.

## Required local benign cohort

Downloaded head sample: 4,582 complete rows from Thursday-15-02-2018 (first 2 MiB; trailing partial line removed), 53 Benign and 4,529 DoS attacks-GoldenEye. This is a strongly biased prefix, not a representative train/test dataset. `download_dataset.py` retrieves the complete original day, checks expected length and writes SHA-256, label counts and provenance to `data/manifest.json`. The head sample overlaps the full day and must never be treated as an independent test set.

Record slow successful requests, network disconnect/retries, backoff retries, shared NAT users, legitimate bursts, expired sessions, forgotten passwords and server-side 5xx errors. Timing alone cannot reveal why a retry happened. Client-supplied retry headers are not trusted proof of benign intent. Slow client networking cannot be inferred from application processing time alone.

## Evaluation gate before automatic enforcement

Split by capture day/session/source, not random rows; remove duplicates across splits. Keep timestamp, IP, label and attack-specific identifiers out of features. Fit preprocessing on training only. Tune thresholds on validation only; evaluate once on held-out days and local traffic.

Report precision, recall, false positive rate, per-benign-cohort false positive rate, PR-AUC, detection delay, added p95 latency and sample counts. Use confidence intervals. Zero observed false positives is not zero true risk: with n independent negatives the approximate 95% upper bound is 3/n. Correlated requests are not independent samples.

Proposed acceptance target (not achieved): benign session false positive upper bound below 0.1%, with sufficient independent slow-user sessions and held-out attack recall reported alongside. Product owner must decide the acceptable tradeoff. Rules remain observe-only by default. No measured production accuracy or trained ML model yet.

Current tests are synthetic engineering checks, not dataset evaluation. High-volume successful requests remain unflagged deliberately; this baseline does not detect all floods or slow-connection attacks. Shared IP enforcement can affect innocent users; production needs validated identity/proxy handling and narrower controls.
