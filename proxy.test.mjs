import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {FirstAgent} from './first-agent.mjs';
import {createObservedProxy} from './proxy.mjs';

async function listen(server){server.listen(0,'127.0.0.1');await once(server,'listening');return `http://127.0.0.1:${server.address().port}`;}
async function close(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
async function settled(agent){for(let i=0;i<100&&agent.active;i++)await delay(5);assert.equal(agent.active,0);}

test('slow successful upstream responses remain successful observations',async()=>{
  const origin=http.createServer((req,res)=>setTimeout(()=>res.end('slow but legitimate'),80));
  const agent=new FirstAgent();const target=await listen(origin);const proxy=createObservedProxy({target,agent});
  try{const response=await fetch(await listen(proxy));assert.equal(await response.text(),'slow but legitimate');
    await settled(agent);const pulse=agent.snapshot();assert.equal(pulse.window.successful,1);assert.equal(pulse.window.errors,0);assert.equal(pulse.decision,'observe');
  }finally{await close(proxy);await close(origin);}
});
test('unavailable upstream produces a measured 502 and releases the active request',async()=>{
  const reserve=http.createServer();const target=await listen(reserve);await close(reserve);
  const agent=new FirstAgent(),proxy=createObservedProxy({target,agent});
  try{const response=await fetch(await listen(proxy));assert.equal(response.status,502);await response.text();await settled(agent);
    const pulse=agent.snapshot();assert.equal(pulse.window.errors,1);assert.equal(pulse.window.upstreamErrors,1);
  }finally{await close(proxy);}
});
test('client disconnect is not attributed to an upstream failure or successful response',async()=>{
  let observed;const received=new Promise(resolve=>observed=resolve);
  const origin=http.createServer(()=>observed());const target=await listen(origin);
  const agent=new FirstAgent(),proxy=createObservedProxy({target,agent});
  try{const client=http.get(await listen(proxy));client.on('error',()=>{});await received;client.destroy();await settled(agent);await delay(20);
    const pulse=agent.snapshot();assert.equal(pulse.completedRequests,1);assert.equal(pulse.window.aborted,1);
    assert.equal(pulse.window.successful,0);assert.equal(pulse.window.upstreamErrors,0);
  }finally{await close(proxy);await close(origin);}
});
