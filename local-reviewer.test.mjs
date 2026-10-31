import test from 'node:test';
import assert from 'node:assert/strict';
import {FirstAgent} from './first-agent.mjs';
import {LocalReviewer} from './local-reviewer.mjs';
function fixture(status=200,duration=50){let now=0;const agent=new FirstAgent({clock:()=>now});for(let i=0;i<30;i++){const r=agent.begin();now+=duration;r.finish({status});}return {pulse:agent.snapshot(),now};}
test('reviewer independently vetoes a worker restriction on successful traffic',()=>{
  const {pulse,now}=fixture();pulse.proposal={suggestedAction:'rate-limit'};
  const result=new LocalReviewer({clock:()=>now}).review(pulse);
  assert.equal(result.workerRestrictionVetoed,true);assert.equal(result.action,'observe');
});
test('server errors are escalated as a health issue without blocking clients',()=>{
  const {pulse,now}=fixture(503);const result=new LocalReviewer({clock:()=>now}).review(pulse);
  assert.equal(result.diagnosis,'service-health-incident');assert.equal(result.action,'observe');
});
test('authentication ambiguity remains an abstention',()=>{
  const {pulse,now}=fixture(401);const result=new LocalReviewer({clock:()=>now}).review(pulse);
  assert.equal(result.diagnosis,'ambiguous-authentication');assert.equal(result.verdict,'abstain');
});
test('stale and inconsistent evidence cannot authorize action',()=>{
  const {pulse,now}=fixture();const reviewer=new LocalReviewer({clock:()=>now+20000});
  assert.equal(reviewer.review(pulse).verdict,'abstain');
  pulse.window.errors=1000;assert.equal(new LocalReviewer({clock:()=>now}).review(pulse).verdict,'abstain');
});
test('slow successful requests are never sufficient evidence for restriction',()=>{
  const {pulse,now}=fixture();pulse.p95LifecycleMsUpperBound=10000;
  const result=new LocalReviewer({clock:()=>now}).review(pulse);
  assert.equal(result.diagnosis,'latency-with-uncertain-cause');assert.equal(result.action,'observe');
});
test('reviewer catches evidence the worker failed to flag',()=>{
  const {pulse,now}=fixture(401);assert.equal(pulse.proposal.type,'no-anomaly');
  assert.equal(new LocalReviewer({clock:()=>now}).review(pulse).relationship,'worker-missed-evidence');
});
test('malformed success counts, baseline, histogram and rates result in abstention',()=>{
  const {pulse,now}=fixture();
  for(const mutate of [p=>p.window.successful=999,p=>p.window.successful=NaN,p=>p.window.histogram=[0],p=>p.requestsPerSecond=900,p=>p.baseline.medianRps=Infinity,p=>p.baseline.state='ready',p=>p.activeRequests=-1,p=>p.p95LifecycleMsUpperBound='fast']){
    const malformed=structuredClone(pulse);mutate(malformed);
    const result=new LocalReviewer({clock:()=>now}).review(malformed);
    assert.equal(result.relationship,'insufficient-evidence');assert.equal(result.action,'observe');
  }
});
test('legitimate traffic surge asks for evidence instead of restricting users',()=>{
  const {pulse,now}=fixture();pulse.baseline={samples:5,state:'ready',medianRps:1};
  const result=new LocalReviewer({clock:()=>now}).review(pulse);
  assert.equal(result.diagnosis,'possible-legitimate-demand');assert.equal(result.action,'observe');
});
test('decision timeline records transitions, deduplicates polling and stays bounded',()=>{
  let now=0;const reviewer=new LocalReviewer({clock:()=>now});
  for(let i=0;i<200;i++){
    const {pulse}=fixture(i%2?503:200);pulse.at=new Date(now).toISOString();
    reviewer.review(pulse);reviewer.review(pulse);now+=5000;
  }
  assert.equal(reviewer.decisions().length,60);
  const copy=reviewer.decisions();copy[0].reasons.push('outside mutation');
  assert.ok(!reviewer.decisions()[0].reasons.includes('outside mutation'));
});
