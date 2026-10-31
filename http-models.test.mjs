import test from 'node:test';
import assert from 'node:assert/strict';
import {extractHttpFeatures,HTTP_FEATURES,HTTP_CAPTURE_LIMIT} from './http-features.mjs';
import {forestScore,HttpInspector} from './http-models.mjs';
import {FirstAgent} from './first-agent.mjs';
import {createObservedProxy} from './proxy.mjs';
import http from 'node:http';
import {once} from 'node:events';
const tree={left:[1,-1,-1],right:[2,-1,-1],feature:[0,-2,-2],threshold:[2,-2,-2],probability:[.5,.1,.9]};
const model={indices:[0],threshold:.5,trees:[tree]};
test('request features exclude host identity and remain bounded numeric measurements',()=>{
  assert.deepEqual(extractHttpFeatures({target:'http://first.test/item?q=hello'}),extractHttpFeatures({target:'https://other.test/item?q=hello'}));
  const x=extractHttpFeatures({target:'/',body:'x'.repeat(HTTP_CAPTURE_LIMIT*10)});
  assert.equal(x.length,HTTP_FEATURES.length);assert.ok(x.every(Number.isFinite));assert.equal(x[1],Math.log1p(HTTP_CAPTURE_LIMIT));
});
test('independent models can disagree and never grant restriction authority',()=>{
  assert.equal(forestScore([3],model),.9);
  const inspector=new HttpInspector({version:'test',worker:model,reviewer:{...model,threshold:.95}});
  const d=inspector.observe({target:'/long-path?password=private-value'});
  assert.equal(d.workerFlag,true);assert.equal(d.reviewerFlag,false);assert.equal(d.relationship,'worker-flag-not-confirmed');assert.equal(d.action,'observe');
  assert.equal(JSON.stringify(inspector.snapshot()).includes('private-value'),false);
  inspector.observe({target:'/large'},{truncated:true});assert.equal(inspector.abstentions,1);
});
test('real streamed HTTP body is scored once; oversized capture abstains without blocking',async t=>{
  const origin=http.createServer((req,res)=>{req.resume();req.on('end',()=>res.end('OK'));});origin.listen(0,'127.0.0.1');await once(origin,'listening');
  const inspector=new HttpInspector({version:'test',worker:model,reviewer:model}),agent=new FirstAgent();
  const proxy=createObservedProxy({target:`http://127.0.0.1:${origin.address().port}`,agent,httpInspector:inspector});proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
  t.after(async()=>{for(const server of [proxy,origin]){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}});
  const url=`http://127.0.0.1:${proxy.address().port}/api`;
  const a=await fetch(url,{method:'POST',body:'name=example'});await a.text();
  const b=await fetch(url,{method:'POST',body:'x'.repeat(HTTP_CAPTURE_LIMIT+1)});await b.text();
  assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(inspector.total,2);assert.equal(inspector.abstentions,1);assert.equal(agent.completed,2);
});
