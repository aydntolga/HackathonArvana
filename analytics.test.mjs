import test from 'node:test';
import assert from 'node:assert/strict';
import {proportion,summarizeRun,loadAnalytics} from './analytics.mjs';
test('scenario accounting retains false positives, misses and abstention separately',()=>{
  const row=(expectedScenario,reviewerEscalated,events=[])=>({expectedScenario,reviewerEscalated,events});
  const s=summarizeRun({results:[row('local-http-flood-overload',true),row('local-http-flood-overload',false),row('legitimate-usage',true),row('legitimate-usage',false,[{verdict:'abstain'}]),row('unlabeled',false)]});
  assert.deepEqual(s.matrix,{tp:1,tn:1,fp:1,fn:1});assert.equal(s.accuracy.value,.5);assert.equal(s.excluded,1);assert.equal(s.abstainingCustomers,1);
});
test('perfect small-sample score still has wide uncertainty and no-data is not zero',()=>{
  assert.equal(proportion(0,0).value,null);assert.equal(proportion(0,0).interval,null);
  const p=proportion(8,8);assert.equal(p.value,1);assert.ok(p.interval[0]>.67&&p.interval[0]<.68);
  assert.ok(proportion(1,1).interval[0]<.21);
});
test('missing runs produce an explicit empty state',async()=>{
  const result=await loadAnalytics(new URL('./data/no-such-analytics-directory/',import.meta.url));assert.equal(result.status,'no-runs');
});
