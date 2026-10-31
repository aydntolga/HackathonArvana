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
