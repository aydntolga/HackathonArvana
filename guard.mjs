// Conservative, explainable baseline. Not a trained ML model.
import { review } from './supervisor.mjs';
export class Guard {
  constructor({ mode = 'observe', clock = Date.now } = {}) {
    this.mode = mode;
    this.clock = clock;
    this.clients = new Map();
    this.events = [];
  }
  record(client, { status = 200, path = '/', duration = 0 } = {}) {
    const now = this.clock();
    if (!this.clients.has(client)) {
      if (this.clients.size >= 5000) this.clients.delete(this.clients.keys().next().value);
      this.clients.set(client, []);
    }
    const rows = this.clients.get(client).filter(r => now - r.at < 60000);
    rows.push({ at: now, status, path, duration });
    this.clients.set(client, rows.slice(-2000));
    return this.inspect(client);
  }
  inspect(client) {
    const rows = (this.clients.get(client) || []).filter(r => this.clock() - r.at < 60000);
    const authFailures = rows.filter(r => r.path === '/login' && [401, 403].includes(r.status)).length;
    const missing = rows.filter(r => r.status === 404);
    const distinctMissing = new Set(missing.map(r => r.path)).size;
    const reasons = [];
    // Slow responses, repeated paths and 5xx errors are NOT attack evidence alone.
    if (rows.length >= 40 && authFailures >= 30 && authFailures / rows.length > .9) reasons.push('Sustained authentication failures');
    if (rows.length >= 80 && distinctMissing >= 40 && missing.length / rows.length > .9) reasons.push('Many distinct nonexistent paths');
    const suspect = reasons.length > 0;
    return { client, requests: rows.length, authFailures, distinctMissing,
      risk: suspect ? 'review' : 'low', reasons,
      action: suspect && this.mode === 'enforce' ? 'rate-limit' : suspect ? 'would-rate-limit' : 'allow',
      model: 'rule-baseline-v1', confidence: null };
  }
  decision(client) {
    return review(this.inspect(client), this.clients.get(client) || [], {mode:this.mode,now:this.clock()});
  }
  snapshot() { return [...this.clients.keys()].map(key => ({...this.inspect(key), supervisor:this.decision(key)})).filter(r => r.requests); }
}
