import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { FirstAgent } from './first-agent.mjs';
import { createObservedProxy } from './proxy.mjs';

test('continuous input uses bounded time buckets and client state',()=>{
  let now=0;const agent=new FirstAgent({clock:()=>now,maxClients:10});
  for(let i=0;i<10000;i++){now=i*1000;agent.begin({address:`client-${i}`}).finish({status:200});}
  assert.ok(agent.buckets.size<=60);assert.ok(agent.clients.size<=10);
  assert.equal(agent.total,10000);assert.equal(agent.active,0);
  now+=61000;assert.equal(agent.snapshot().window.completed,0);
});
test('slow request is observed, not judged malicious; lifecycle finishes only once',()=>{
  let now=0;const agent=new FirstAgent({clock:()=>now});
  const request=agent.begin({address:'private-address'});now=15000;
  request.finish({status:200});request.finish({status:500,aborted:true});
  const result=agent.snapshot();
  assert.equal(result.completedRequests,1);assert.equal(result.activeRequests,0);
  assert.equal(result.decision,'observe');assert.equal(result.window.errors,0);
  assert.ok(!JSON.stringify(result).includes('private-address'));
});
test('baseline freezes during error windows',()=>{
  let now=0;const agent=new FirstAgent({clock:()=>now});
  now=61000;for(let i=0;i<50;i++)agent.begin().finish({status:503});
  assert.equal(agent.snapshot().baseline.samples,0);
  assert.ok(agent.snapshot().warnings.length);
});
test('proxy forwards streamed body and methods, strips forged identity, and records completion',async()=>{
  const origin=http.createServer((req,res)=>{
    let body='';req.on('data',chunk=>body+=chunk);
    req.on('end',()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({body,method:req.method,forged:req.headers['x-forwarded-for']||null}));});
  });
  origin.listen(0,'127.0.0.1');await once(origin,'listening');
  const agent=new FirstAgent();
  const proxy=createObservedProxy({agent,target:`http://127.0.0.1:${origin.address().port}`});
  proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
  try {
    const response=await fetch(`http://127.0.0.1:${proxy.address().port}/upload`,{method:'POST',body:'private payload',headers:{'x-forwarded-for':'forged-address'}});
    assert.deepEqual(await response.json(),{body:'private payload',method:'POST',forged:null});
    const snapshot=agent.snapshot();
    assert.equal(snapshot.totalRequests,1);assert.equal(snapshot.completedRequests,1);
    assert.equal(snapshot.window.bytesIn,15);
    assert.ok(!JSON.stringify(snapshot).includes('private payload'));
  }finally {proxy.closeAllConnections();origin.closeAllConnections();await Promise.all([new Promise(r=>proxy.close(r)),new Promise(r=>origin.close(r))]);}
});
