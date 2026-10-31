import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, appendFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { DailyLearning, collectDataset, loadBundle } from './daily-learning.mjs';
import { sourceId, extractFeatures } from './model-features.mjs';
import { trainPair, evaluatePulse } from './local-models.mjs';
import { LocalReviewer } from './local-reviewer.mjs';
import { FirstAgent } from './first-agent.mjs';

const NOW=Date.parse('2026-10-31T12:00:00Z'),SOURCE=sourceId('http://fixture.test');
function pulse(at,overrides={}) {
  return {at:new Date(at).toISOString(),schemaVersion:1,sourceId:SOURCE,windowSeconds:60,
    requestsPerSecond:1,activeRequests:1,p95LifecycleMsUpperBound:100,
    baseline:{samples:5,medianRps:1,state:'ready'},warnings:[],proposal:{type:'no-anomaly',suggestedAction:'observe'},
    window:{started:60,completed:60,successful:60,errors:0,authFailures:0,missing:0,aborted:0,upstreamErrors:0,histogram:[0,60,0,0,0,0,0,0,0,0]},...overrides};
}
async function fixture(t) {
  const tempRoot=new URL('./data/models/',import.meta.url);
  await mkdir(tempRoot,{recursive:true});
  const root=await mkdtemp(new URL('test-',tempRoot));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const telemetryDirectory=path.join(root,'telemetry'),modelDirectory=path.join(root,'models');
  await mkdir(telemetryDirectory);
  const rows=[];
  for(const [day,count] of [['2026-10-28',120],['2026-10-29',30],['2026-10-30',30]]) {
    const daily=Array.from({length:count},(_,i)=>pulse(Date.parse(day)+i*60000));rows.push(...daily);
    await writeFile(path.join(telemetryDirectory,day+'.jsonl'),daily.map(JSON.stringify).join('\n')+'\n');
  }
  const learning=await new DailyLearning({telemetryDirectory,modelDirectory,source:SOURCE,clock:()=>NOW}).init();
  return {root,telemetryDirectory,modelDirectory,learning,rows};
}
test('daily ETL trains and reloads a shared model pair using three separate UTC days',async t=>{
  const {learning,modelDirectory}=await fixture(t);
  const result=await learning.run();
  assert.equal(result.status,'promoted',JSON.stringify(result));assert.deepEqual(result.split,{train:120,calibration:30,test:30});
  const loaded=await loadBundle(modelDirectory,SOURCE,NOW);assert.equal(loaded.version,result.activeVersion);
  const p=pulse(NOW);
  const worker=evaluatePulse(p,loaded,'worker',NOW),reviewer=evaluatePulse(p,loaded,'reviewer',NOW);
  assert.equal(worker.datasetHash,reviewer.datasetHash);assert.notEqual(worker.method,reviewer.method);
  assert.equal(worker.unusual,false);assert.equal(reviewer.unusual,false);
  assert.equal((await learning.run()).generatedAt,result.generatedAt);
  assert.equal(await loadBundle(modelDirectory,sourceId('http://other.test'),NOW),null);
  assert.equal(await loadBundle(modelDirectory,SOURCE,NOW+8*86400000),null);
});
test('current day, wrong source, malformed rows and duplicates cannot enter the training set',async t=>{
  const {telemetryDirectory}=await fixture(t);
  const row=pulse(Date.parse('2026-10-30'));
  await appendFile(path.join(telemetryDirectory,'2026-10-30.jsonl'),[
    JSON.stringify(row),JSON.stringify({...row,sourceId:'another'}),'broken',
    JSON.stringify({...row,requestsPerSecond:999}),JSON.stringify(pulse(NOW))
  ].join('\n'));
  await writeFile(path.join(telemetryDirectory,'2026-10-31.jsonl'),JSON.stringify(pulse(NOW)));
  const data=await collectDataset(telemetryDirectory,SOURCE,NOW);
  assert.equal(data.rows.length,180);assert.equal(data.counts.duplicates,1);
  assert.equal(data.counts.wrongSource,1);assert.equal(data.counts.invalid,3);
});
test('agent opinions cannot poison reference selection; slow successful traffic remains eligible',async t=>{
  const {telemetryDirectory}=await fixture(t);
  const p=pulse(Date.parse('2026-10-30T01:00:00Z'),{p95LifecycleMsUpperBound:10000,review:{verdict:'escalate'},proposal:{suggestedAction:'rate-limit'}});
  await appendFile(path.join(telemetryDirectory,'2026-10-30.jsonl'),JSON.stringify(p)+'\n');
  const data=await collectDataset(telemetryDirectory,SOURCE,NOW);
  assert.equal(data.rows.at(-1).reference,true);
  const bad=structuredClone(p);bad.at='2026-10-30T01:01:00Z';bad.window.successful=0;bad.window.errors=60;bad.review={verdict:'observe'};
  await appendFile(path.join(telemetryDirectory,'2026-10-30.jsonl'),JSON.stringify(bad)+'\n');
  const updated=await collectDataset(telemetryDirectory,SOURCE,NOW);
  assert.equal(updated.rows.at(-1).reference,false);
});
test('calibration and holdout never change fitted centers or reference memory',()=>{
  const row={at:'2026-10-28T00:00:00Z',features:extractFeatures(pulse(NOW))};
  const shifted={...row,features:{...row.features,logRps:100,logLatency:100}};
  const a=trainPair([row],[row],[row]),b=trainPair([row],[shifted],[shifted]);
  assert.deepEqual(a.worker.center,b.worker.center);assert.deepEqual(a.reviewer.references,b.reviewer.references);
  assert.notEqual(a.worker.threshold,b.worker.threshold);
});
test('quality gate retains the active pair when later reference traffic drifts',async t=>{
  const {learning,telemetryDirectory}=await fixture(t);
  await learning.run();const version=learning.bundle.version;
  const shifted=Array.from({length:30},(_,i)=>pulse(Date.parse('2026-10-30')+i*60000,{activeRequests:100000,p95LifecycleMsUpperBound:30000}));
  await writeFile(path.join(telemetryDirectory,'2026-10-30.jsonl'),shifted.map(JSON.stringify).join('\n'));
  assert.equal((await learning.run({force:true})).status,'quality-gate-rejected');
  assert.equal(learning.bundle.version,version);
});
test('tampered artifact falls back to rules instead of loading unverified weights',async t=>{
  const {learning,modelDirectory}=await fixture(t);await learning.run();
  await appendFile(path.join(modelDirectory,learning.bundle.version+'.json'),' ');
  assert.equal(await loadBundle(modelDirectory,SOURCE,NOW),null);
});
test('both live agents consume models and the reviewer independently catches unfamiliar context',async t=>{
  const {learning}=await fixture(t);await learning.run();
  let clock=NOW-60000;
  const agent=new FirstAgent({clock:()=>clock,modelProvider:()=>learning.bundle});clock=NOW;
  for(let i=0;i<60;i++)agent.begin().finish({status:200});
  assert.equal(agent.snapshot().model.version,learning.bundle.version);
  const p=pulse(NOW);p.window.successful=30;p.window.missing=30;
  const reviewer=new LocalReviewer({clock:()=>NOW,modelProvider:()=>learning.bundle});
  const audit=reviewer.review(p);
  assert.equal(audit.model.unusual,true);assert.equal(audit.relationship,'worker-missed-evidence');
  assert.equal(audit.action,'observe');assert.equal(audit.verdict,'request-more-evidence');
  assert.ok(audit.model.nearestReferences.length);
  p.proposal.suggestedAction='rate-limit';assert.equal(reviewer.review(p).relationship,'worker-restriction-vetoed');
});
test('insufficient data stays untrained and overlapping runs are rejected',async t=>{
  const {learning,telemetryDirectory}=await fixture(t);
  await rm(path.join(telemetryDirectory,'2026-10-28.jsonl'));
  const first=learning.run();assert.equal((await learning.run()).status,'already-running');
  assert.equal((await first).status,'insufficient-data');assert.equal(learning.bundle,null);
});
test('rollback restores both layers together and a second writer cannot acquire the lock',async t=>{
  const {learning,telemetryDirectory,modelDirectory}=await fixture(t);
  await learning.run();const original=learning.bundle.version;
  await appendFile(path.join(telemetryDirectory,'2026-10-28.jsonl'),JSON.stringify(pulse(Date.parse('2026-10-28T04:00:00Z')))+'\n');
  await learning.run({force:true});assert.notEqual(learning.bundle.version,original);
  assert.equal(await learning.rollback(),original);
  assert.equal((await loadBundle(modelDirectory,SOURCE,NOW)).version,original);
  await writeFile(path.join(modelDirectory,'learning.lock'),JSON.stringify({pid:process.pid}));
  assert.equal((await learning.run({force:true})).status,'already-running');
});
test('adjacent minute timestamps less than 60 seconds apart are not independent examples',async t=>{
  const {telemetryDirectory}=await fixture(t);
  const day='2026-10-30';
  await writeFile(path.join(telemetryDirectory,day+'.jsonl'),[
    pulse(Date.parse(day+'T00:00:59Z')),pulse(Date.parse(day+'T00:01:00Z'))
  ].map(JSON.stringify).join('\n'));
  const data=await collectDataset(telemetryDirectory,SOURCE,NOW);
  assert.equal(data.counts.overlapping,1);assert.equal(data.rows.filter(r=>r.at.startsWith(day)).length,1);
});
