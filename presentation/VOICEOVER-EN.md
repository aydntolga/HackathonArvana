# Server Doctor — final 120-second voiceover

Read the sections within the indicated time ranges. The video is silent so you can record your own voice. Pause briefly between sections.

## 00:00–00:13 — Product output
Server Doctor turns API traffic into early risk information. Our output is a clear brief: what needs attention, why it matters, and what the team should investigate next.

## 00:13–00:29 — Two layers
The first agent detects unusual measurements and request patterns. An independent reviewer checks the evidence and can disagree. Today, this uses local machine-learning classifiers and evidence rules, not an LLM. It informs teams without automatically blocking users.

## 00:29–00:46 — Actual HTTP experiment
We tested eight local customer scenarios using real HTTP requests. Seven represented legitimate usage; one created controlled overload. Across 1,645 completed requests, the system identified the service-health incident in approximately 1.13 seconds. This was a local experiment, not a distributed attack.

## 00:46–01:01 — Legitimate users
A slow connection should not become a guilty verdict. Our slow-client scenario completed 114 requests without restrictions or health escalation. The reviewer preserved uncertainty instead of treating latency alone as malicious behavior.

## 01:01–01:17 — Data pipeline
We downloaded 97,065 generated research requests and retained 34,490 unique examples. Training, validation and testing are separated. Daily service-health learning remains a different pipeline from supervised request-model training.

## 01:17–01:37 — Measured performance
On 6,898 known-application development test requests, the first model achieved 93.87 percent accuracy. The upper model achieved 97.58 percent accuracy, 95.62 percent anomaly recall, and 0.75 percent normal false alarms. These are research benchmark results, not production DDoS guarantees.

## 01:37–01:51 — Honest boundaries
Unseen endpoints remain challenging: upper-model recall falls to about 40 percent. Our next step is independent customer validation. Traffic evidence alone cannot prove vulnerability or predict the next attack.

## 01:51–02:00 — Close
Server Doctor: continuous observation, independent review, and a clearer next step. An evidence-based second opinion for your servers.
