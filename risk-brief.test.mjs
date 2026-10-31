import test from 'node:test';import assert from 'node:assert/strict';import {riskBrief} from './risk-brief.mjs';
const now=Date.now(),at=new Date(now).toISOString();
test('missing and stale evidence cannot declare security',()=>{for(const pulse of [{},{at:new Date(now-60000).toISOString(),window:{completed:12}}]){const r=riskBrief(pulse,{},now);assert.equal(r.level,'insufficient-evidence');assert.equal(r.vulnerabilityStatus,'not-assessed');assert.equal(r.attackLikelihood,null);}});
test('fresh request concerns inform without declaring an attack',()=>{const r=riskBrief({}, {recent:[{at,reviewerFlag:true,workerFlag:true}]},now);assert.equal(r.level,'elevated');assert.equal(r.action,'inform-only');assert.equal(r.forecastHorizon,null);});
test('expired flags do not keep a risk warning alive',()=>{const r=riskBrief({at,window:{completed:10}}, {recent:[{at:new Date(now-61000).toISOString(),reviewerFlag:true}]},now);assert.equal(r.level,'no-current-signal');});
test('current service deterioration creates a resilience advisory',()=>{assert.equal(riskBrief({at,window:{completed:10},review:{verdict:'escalate'}},{},now).level,'high');});
