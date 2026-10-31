import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createCustomerSite,localRequest,CUSTOMERS} from './realtime-lab.mjs';

test('traffic generator rejects all external targets, names and protocols',async()=>{
  for(const url of ['https://127.0.0.1/','http://localhost/','http://example.com/','http://127.0.0.1.example.com/','http://user:secret@127.0.0.1/']){
    await assert.rejects(localRequest(url),/restricted/);
  }
});
test('customer sites expose real HTTP APIs; capacity exhaustion is caused by concurrency',async t=>{
  const server=createCustomerSite(CUSTOMERS.find(c=>c.id==='overload'));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const url=`http://127.0.0.1:${server.address().port}`;
  assert.equal(await localRequest(url+'/api/items'),200);
  const statuses=await Promise.all(Array.from({length:8},()=>localRequest(url+'/api/items')));
  assert.equal(statuses.filter(s=>s===503).length,6);
  assert.equal(statuses.filter(s=>s===200).length,2);
  assert.equal(await localRequest(url+'/api/items'),200);
});
test('healthy campaign handles the same concurrency without synthetic failures',async t=>{
  const server=createCustomerSite(CUSTOMERS.find(c=>c.id==='campaign'));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const url=`http://127.0.0.1:${server.address().port}/api/items`;
  assert.deepEqual(await Promise.all(Array.from({length:8},()=>localRequest(url))),Array(8).fill(200));
});
