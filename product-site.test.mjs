import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createProductSite} from './product-site.mjs';
test('presentation website serves its own assets and cannot expose internal measurements',async t=>{
  const server=createProductSite();server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const root=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(root)).status,200);
  assert.equal((await fetch(root+'/site.css')).status,200);
  for(const route of ['/api/analytics','/api/pulse','/api/learning','/data/measurement/report.json','/../server.mjs'])assert.equal((await fetch(root+route)).status,404);
});
