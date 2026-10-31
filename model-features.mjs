import { createHash } from 'node:crypto';

export const sourceId = target => createHash('sha256').update(target).digest('hex');
export const WORKER_FEATURES = ['logRps','logActive','logLatency','errorRate','abortRate'];
export const REVIEWER_FEATURES = ['successRate','errorRate','authRate','missingRate','abortRate','transportRate','logLatency','activePerRequest'];

// Only measurements become features. Neither agent's decisions become training labels.
export function extractFeatures(pulse) {
  const w=pulse?.window, n=w?.completed;
  const keys=['started','completed','successful','errors','authFailures','missing','aborted','upstreamErrors'];
  if(!w||keys.some(k=>!Number.isSafeInteger(w[k])||w[k]<0)||n<20||
    !Number.isFinite(Date.parse(pulse.at))||pulse.windowSeconds!==60||
    !Number.isFinite(pulse.requestsPerSecond)||pulse.requestsPerSecond<0||
    Math.abs(pulse.requestsPerSecond-w.started/60)>.015||
    !Number.isSafeInteger(pulse.activeRequests)||pulse.activeRequests<0||
    w.successful+w.errors+w.authFailures+w.missing>n||w.aborted>n||w.upstreamErrors>n||
    !Array.isArray(w.histogram)||w.histogram.length!==10||w.histogram.some(x=>!Number.isSafeInteger(x)||x<0)||w.histogram.reduce((a,b)=>a+b,0)!==n)return null;
  const latency=pulse.p95LifecycleMsUpperBound==='>30000'?60000:pulse.p95LifecycleMsUpperBound;
  if(!Number.isFinite(latency)||latency<0)return null;
  return {logRps:Math.log1p(pulse.requestsPerSecond),logActive:Math.log1p(pulse.activeRequests),
    logLatency:Math.log1p(latency),successRate:w.successful/n,errorRate:w.errors/n,
    authRate:w.authFailures/n,missingRate:w.missing/n,abortRate:w.aborted/n,
    transportRate:w.upstreamErrors/n,activePerRequest:pulse.activeRequests/Math.max(1,w.started)};
}

export function isReference(f) {
  // Operational reference cohort, NOT verified benign traffic. Slow successful clients are retained.
  return f.successRate>=.95&&f.errorRate<=.01&&f.authRate<=.02&&f.abortRate<=.02&&f.transportRate===0;
}
