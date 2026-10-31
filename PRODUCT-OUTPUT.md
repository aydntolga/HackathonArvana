# Product output: early risk advisory

Input: observed HTTP/API traffic. Two local ML request classifiers supplement service-health agents. The current implementation is not an LLM.

GET /api/risk-brief returns a level, headline, evidence, next steps and explicit uncertainty. Levels: insufficient-evidence, no-current-signal, review-needed, elevated, high. High means observed service stress, not confirmed malicious activity. Evidence expires; absent evidence never means secure. The advisory is deterministic evidence fusion, not a separately validated predictive model.

The output provides proactive investigation information without external alarms or blocking. Traffic alone cannot establish whether a server is vulnerable. vulnerabilityStatus is not-assessed; attackLikelihood and forecastHorizon are null. A genuine vulnerability assessment needs authorized configuration/code review or scanning. No future-attack lead-time claim has been measured.

Daily service-health ETL remains separate from supervised request-model training. Labeled representative data and external validation are required before automatic action. See HTTP_RESEARCH.md for measured strengths and generalization failures.
