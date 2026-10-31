import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import path from 'node:path';
const fingerprint=source=>createHash('sha256').update(source).digest('hex');
export async function restoreBaseline(file,agent,source){
  try{
    if((await stat(file)).size>65536)throw Error('Baseline file exceeds size limit');
    const stored=JSON.parse(await readFile(file,'utf8')),now=agent.clock();
    if(stored.version!==1||stored.source!==fingerprint(source))return {status:'different-source',restoredSamples:0};
    if(!Number.isFinite(stored.savedAt)||stored.savedAt>now+1000)throw Error('Invalid baseline timestamp');
    if(now-stored.savedAt>86400000)return {status:'expired',restoredSamples:0};
    if(!Array.isArray(stored.samples)||stored.samples.length>60)throw Error('Invalid baseline samples');
    let previous=-Infinity;
    for(const sample of stored.samples){
      if(!Number.isFinite(sample.at)||sample.at>stored.savedAt||sample.at-previous<60000||!Number.isFinite(sample.rps)||sample.rps<0)throw Error('Invalid baseline sample');
      previous=sample.at;
    }
    agent.baseline=stored.samples.filter(s=>now-s.at<=86400000).map(s=>({...s}));
    return {status:'restored',restoredSamples:agent.baseline.length};
  }catch(error){return {status:error.code==='ENOENT'?'new':'invalid',restoredSamples:0,...(error.code==='ENOENT'?{}:{error:error.message})};}
}
export async function saveBaseline(file,agent,source){
  await mkdir(path.dirname(file),{recursive:true});
  const stored={version:1,source:fingerprint(source),savedAt:agent.clock(),samples:agent.baseline.map(s=>({...s}))};
  // A partial checkpoint is rejected on restore and triggers a fresh warm-up.
  await writeFile(file,JSON.stringify(stored),{flush:true});
}
