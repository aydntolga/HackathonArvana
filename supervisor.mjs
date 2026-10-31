// Independent deterministic review policy. This is not an LLM or calibrated ML model.
// The supervisor reads observations, not just the worker's explanation/score.
export function review(proposal, observations, { mode = 'observe', now = Date.now() } = {}) {
  const rows = observations.filter(r => now - r.at >= 0 && now - r.at < 60000);
  const audit = { worker: proposal, reviewer: 'supervisor-policy-v1', verdict: 'allow', action: 'allow', reasons: [] };
  if (!['would-rate-limit', 'rate-limit'].includes(proposal.action)) {
    audit.reasons.push('Worker requested no intervention; continue observation');
    return audit;
  }
  const failures = rows.filter(r => r.path === '/login' && [401,403].includes(r.status));
  const missing = rows.filter(r => r.status === 404);
  const distinct = new Set(missing.map(r => r.path)).size;
  const windows = new Set(rows.map(r => Math.floor(r.at / 10000))).size;
  const successRate = rows.filter(r => r.status >= 200 && r.status < 400).length / Math.max(1,rows.length);
  const serverErrors = rows.filter(r => r.status >= 500).length / Math.max(1,rows.length);
  const sustained = rows.length >= 40 && Math.max(...rows.map(r=>r.at)) - Math.min(...rows.map(r=>r.at)) >= 20000 && windows >= 3;
  const authEvidence = failures.length >= 30 && failures.length / Math.max(1,rows.length) > .95;
  const scanEvidence = distinct >= 40 && missing.length / Math.max(1,rows.length) > .95;
  if (!sustained) audit.reasons.push('Insufficient observation duration; burst may be retries');
  if (successRate >= .05) audit.reasons.push('Successful traffic present; shared identity or legitimate usage possible');
  if (serverErrors > .1) audit.reasons.push('Server failure may explain retry traffic');
  if (!authEvidence && !scanEvidence) audit.reasons.push('Raw evidence does not corroborate the worker');
  if (audit.reasons.length) { audit.verdict='veto'; return audit; }
  if (authEvidence && !scanEvidence) {
    audit.verdict='needs-additional-evidence';
    audit.action='allow';
    audit.reasons.push('Failed login loops and brute force are ambiguous; recommend account verification, do not automatically restrict access');
    audit.recommendation='step-up-verification';
    return audit;
  }
  audit.verdict='approve-temporary-limit';
  audit.action=mode==='enforce'?'rate-limit':'would-rate-limit';
  audit.reasons.push('Persistent pattern corroborated; narrow temporary action only; malicious intent remains uncertain');
  audit.ttlSeconds=60;
  return audit;
}
