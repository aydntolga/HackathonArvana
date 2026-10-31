import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,readFile} from 'node:fs/promises';
import {measureModels} from './measure-models.mjs';
test('two serialized ETL batches fit both models and score disjoint held-out IDs',async t=>{
  const parent=new URL('./data/measurement/',import.meta.url);await mkdir(parent,{recursive:true});
  const folder=await mkdtemp(new URL('test-',parent));t.after(()=>rm(folder,{recursive:true,force:true}));
  const r=await measureModels(folder);
  assert.equal(r.transfers.length,2);assert.equal(r.transfers.reduce((n,b)=>n+b.accepted,0),4500);
  assert.equal(r.split.test,2000);assert.equal(r.metrics.worker.accuracy.total,2000);assert.equal(r.metrics.reviewer.accuracy.total,2000);
  const a=(await readFile(folder+'/transfer-1.jsonl','utf8')).trim().split('\n').map(JSON.parse);
  const b=(await readFile(folder+'/transfer-2.jsonl','utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(new Set([...a,...b].map(x=>x.id)).size,4500);
  assert.ok(a.every(x=>!x.expectedIncident));assert.ok(b.slice(0,500).every(x=>!x.expectedIncident));
  assert.equal(b.slice(500).filter(x=>x.expectedIncident).length,1000);
  assert.equal(r.protocol.provenance.startsWith('Deterministic synthetic'),true);
  assert.equal(r.metrics.reviewer.falseAlarmRate.success,r.cohorts.filter(x=>!x.expectedIncident).reduce((n,c)=>n+c.reviewerAlerts,0));
});
