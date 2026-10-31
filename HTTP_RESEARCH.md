# HTTP research models

Two independent local TF-IDF character-pattern + structural logistic classifiers now inspect bounded HTTP request content in observation mode. They supplement, rather than replace, the existing service-health window models and daily ETL registry. The request classifiers require labeled research training; unlabeled daily traffic does not automatically retrain them.

## Evidence

CSIC 2010: 97,065 generated research requests downloaded, 34,490 unique after normalized request deduplication. Source hashes are recorded. Provider documentation: https://www.impactcybertrust.org/dataset_view?idDataset=940 . The anomalous label includes invalid requests, not only intentional attacks. This is not production DDoS data. Raw data and fitted vocabularies remain ignored locally; redistribution/commercial permissions are not established.

Known-application split: 20,694 training / 6,898 validation / 6,898 test requests. Exact feature-vector groups do not cross partitions; endpoint families may. Vocabulary, scaling and weights fit training only. Thresholds maximize validation recall under a 1% validation false-alarm ceiling. Test false-alarm rates may exceed that ceiling. This is a supervised regrouping, not the provider's original anomaly-only protocol.

| Model | Accuracy | Anomaly recall | Precision | Normal false alarms |
|---|---:|---:|---:|---:|
| First | 93.87% | 87.85% | 98.65% | 1.02% |
| Upper | 97.58% | 95.62% | 99.08% | 0.75% |

The structural-only upper baseline scored 80.40% on the same split. The lexical model scores 97.58%. Because the test was reused for this development comparison, an independent external evaluation is still required. These numbers cannot be compared directly with the older 85.75% synthetic service-health result.

## Generalization failure retained

A separately trained endpoint-template-grouped stress evaluation has 6,839 test requests. First model: 72.58% accuracy, 34.03% recall. Upper: 75.10% accuracy, 39.99% recall. Conservative validation thresholds suppress false alarms but miss many anomalies. A separate legitimate-query smoke check also flags both models. Neither result supports general deployment or automatic blocking.

Release objective: at least 95% anomaly recall and at most 1% normal false alarms on representative independently labeled customer data, evaluated per application and time period. The known-app upper point estimates meet those numerical targets; external qualification does not.

## Runtime and privacy

Python and JavaScript predictions match on 50 parity requests within 2.7e-15. The measured model-pair p95 microbenchmark is approximately 0.29 ms on this machine, not end-to-end proxy latency. All 58 automated tests pass, including streamed-body forwarding, bounded capture and abstention.

The proxy temporarily inspects at most 16 KiB of body and a bounded URL. It stores scores/flags, not raw inspector payloads. Truncated or partial requests abstain. Payload inspection is local; there is no external model call. Headers, cookies, host identity and source-file labels are excluded from features. Observe-only mode never blocks requests.

## Reproduce

Install `requirements-research.txt` in a Python virtual environment, then run:

```
npm run research:download
npm run research:prepare
npm run research:train
npm run research:stress
npm run research:validate
npm test
```

Restart the server after training to load the hash-verified model pair. Reports and weights are in ignored `data/http-research/`; the strict stress model stays separate under `unseen-lexical/`. The internal console is http://localhost:3000/#research ; the separate presentation website is http://localhost:3003/ . The public website exposes no internal measurement API.

The final silent 120-second video and timed English voiceover are available in presentation/. They distinguish the research benchmark from the local HTTP experiment.

