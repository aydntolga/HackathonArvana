import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {FirstAgent} from './first-agent.mjs';
import {saveBaseline,restoreBaseline} from './baseline-store.mjs';
test('baseline survives restart but is not reused for a different upstream or after expiry',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'doctor-baseline-')),file=path.join(directory,'baseline.json');
  try{
    let now=0;const original=new FirstAgent({clock:()=>now});
    for(let minute=1;minute<=5;minute++){now=minute*60000;for(let i=0;i<30;i++)original.begin().finish({status:200});original.snapshot();}
    assert.equal(original.snapshot().baseline.state,'ready');await saveBaseline(file,original,'https://example.invalid');
    const restarted=new FirstAgent({clock:()=>now});assert.equal((await restoreBaseline(file,restarted,'https://example.invalid')).restoredSamples,5);
    assert.equal(restarted.snapshot().baseline.state,'ready');
    const other=new FirstAgent({clock:()=>now});assert.equal((await restoreBaseline(file,other,'https://other.invalid')).status,'different-source');assert.equal(other.baseline.length,0);
    now+=86400001;assert.equal((await restoreBaseline(file,other,'https://example.invalid')).status,'expired');
    await writeFile(file,'broken');assert.equal((await restoreBaseline(file,other,'https://example.invalid')).status,'invalid');
  }finally{await rm(directory,{recursive:true,force:true});}
});
