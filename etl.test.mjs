import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,appendFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {FirstAgent} from './first-agent.mjs';
import {createObservedProxy} from './proxy.mjs';
import {createDemoSite} from './demo-site.mjs';
import {startTelemetry} from './telemetry.mjs';
import {runEtl} from './etl-core.mjs';
import {LocalReviewer} from './local-reviewer.mjs';
test('real local website -> proxy -> agent -> reviewer -> telemetry -> hourly ETL',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'server-doctor-test-'));
  const origin=createDemoSite();origin.listen(0,'127.0.0.1');await once(origin,'listening');
  const agent=new FirstAgent();const proxy=createObservedProxy({agent,target:`http://127.0.0.1:${origin.address().port}`});
  proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
  const writer=startTelemetry(agent,directory,{intervalMs:60000,reviewer:new LocalReviewer()});
  try{
    const url=`http://127.0.0.1:${proxy.address().port}`;
    for(let i=0;i<20;i++)assert.equal((await fetch(url+'/products')).status,200);
    for(let i=0;i<5;i++)assert.equal((await fetch(url+'/failure')).status,503);
    assert.equal((await fetch(url+'/slow')).status,200);
    const pulse=agent.snapshot();assert.equal(pulse.totalRequests,26);assert.equal(pulse.window.errors,5);
    assert.equal(new LocalReviewer().review(pulse).diagnosis,'service-health-incident');
    await writer.flush();assert.equal(writer.state.lastError,null);
    const file=path.join(directory,writer.state.lastWrite.slice(0,10)+'.jsonl');
    await appendFile(file,'not-json\n{"at":"bad"}\n');
    const report=await runEtl(directory,path.join(directory,'hourly.json'));
    assert.equal(report.invalidLines,2);assert.equal(report.hours.length,1);assert.equal(report.hours[0].samples,1);
    assert.equal(report.hours[0].reviewedSamples,1);assert.equal(report.hours[0].reviewVerdicts.escalate,1);
    const stored=await readFile(file,'utf8');assert.ok(!stored.includes('127.0.0.1'));assert.ok(!stored.includes('/products'));
  }finally{writer.stop();proxy.closeAllConnections();origin.closeAllConnections();await Promise.all([new Promise(r=>proxy.close(r)),new Promise(r=>origin.close(r))]);await rm(directory,{recursive:true,force:true});}
});
test('ETL rejects mismatched reviews without dropping valid telemetry',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'doctor-etl-'));
  try{
    const agent=new FirstAgent(),pulse=agent.snapshot();
    pulse.review=new LocalReviewer().review(pulse);pulse.review.sourceAt='2000-01-01T00:00:00.000Z';
    await appendFile(path.join(directory,pulse.at.slice(0,10)+'.jsonl'),JSON.stringify(pulse)+'\n');
    const report=await runEtl(directory,path.join(directory,'report.json'));
    assert.equal(report.invalidReviews,1);assert.equal(report.hours[0].samples,1);assert.equal(report.hours[0].reviewedSamples,0);
  }finally{await rm(directory,{recursive:true,force:true});}
});
