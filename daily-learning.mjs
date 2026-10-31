import { mkdir, readdir, readFile, writeFile, stat, rename, open, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { extractFeatures, isReference, WORKER_FEATURES, REVIEWER_FEATURES } from './model-features.mjs';
import { trainPair } from './local-models.mjs';
import { runEtl } from './etl-core.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const DAY=86400000;
async function acquireLock(directory) {
  const file=path.join(directory,'learning.lock');
  try {
    const handle=await open(file,'wx');
    await handle.writeFile(JSON.stringify({pid:process.pid}));await handle.close();
    return async()=>unlink(file);
  }catch(error){
    if(error.code!=='EEXIST')throw error;
    // Recover only when the owning process is definitely gone. Unknown ownership stays locked.
    try {
      const {pid}=JSON.parse(await readFile(file,'utf8'));
      if(!Number.isSafeInteger(pid)||pid<=0)return null;
      try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH'){await unlink(file);return acquireLock(directory);}}
    }catch{}
    return null;
  }
}
async function atomicJson(file,value) {
  const temporary=`${file}.${process.pid}.tmp`;
  await writeFile(temporary,JSON.stringify(value,null,2),{flush:true});
  await rename(temporary,file);
}
function validateBundle(b,source,now) {
  if(b.schema!==1||b.sourceId!==source||!/^\w{16}$/.test(b.version)||! /^[a-f0-9]{64}$/.test(b.datasetHash)||
    !Number.isFinite(Date.parse(b.createdAt))||Date.parse(b.createdAt)>now+60000||now-Date.parse(b.createdAt)>7*DAY)throw Error('Invalid or expired model bundle');
  for(const [name,features,kind] of [['worker',WORKER_FEATURES,'robust-distance'],['reviewer',REVIEWER_FEATURES,'nearest-reference']]){
    const m=b[name];
    if(!m||m.kind!==kind||JSON.stringify(m.features)!==JSON.stringify(features)||
      !Array.isArray(m.center)||m.center.length!==features.length||m.center.some(x=>!Number.isFinite(x))||
      !Array.isArray(m.scale)||m.scale.length!==features.length||m.scale.some(x=>!Number.isFinite(x)||x<=0)||
      !Number.isFinite(m.threshold)||m.threshold<3)throw Error('Invalid model parameters');
  }
  const refs=b.reviewer.references;
  if(!Array.isArray(refs)||!refs.length||refs.length>256||refs.some(r=>!Number.isFinite(Date.parse(r.at))||!Array.isArray(r.values)||r.values.length!==REVIEWER_FEATURES.length||r.values.some(x=>!Number.isFinite(x))))throw Error('Invalid reference memory');
  return b;
}
export async function loadBundle(directory,source,now=Date.now(),slot='active') {
  try {
    const registry=JSON.parse(await readFile(path.join(directory,'registry.json'),'utf8'));
    const entry=registry[slot];
    if(!entry||! /^[a-f0-9]{16}$/.test(entry.version))return null;
    const file=path.join(directory,`${entry.version}.json`);
    if((await stat(file)).size>1024*1024)throw Error('Oversized model');
    const raw=await readFile(file,'utf8');
    if(hash(raw)!==entry.sha256)throw Error('Model checksum mismatch');
    const b=validateBundle(JSON.parse(raw),source,now);
    if(b.version!==entry.version)throw Error('Version mismatch');
    return b;
  }catch{return null;}
}

export async function collectDataset(directory,source,now=Date.now()) {
  await mkdir(directory,{recursive:true});
  const today=new Date(now).toISOString().slice(0,10),rows=[],seen=new Set();
  const counts={invalid:0,wrongSource:0,duplicates:0,excludedReference:0,oversizedFiles:0};
  for(const file of (await readdir(directory)).sort()) {
    if(!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file)||file.slice(0,10)>=today||now-Date.parse(file.slice(0,10))>8*DAY)continue;
    const filename=path.join(directory,file);
    if((await stat(filename)).size>16*1024*1024){counts.oversizedFiles++;continue;}
    for(const line of (await readFile(filename,'utf8')).split('\n')) {
      if(!line.trim())continue;
      try {
        const p=JSON.parse(line);
        if(p.sourceId!==source){counts.wrongSource++;continue;}
        const features=extractFeatures(p);
        if(!features||p.schemaVersion!==1||new Date(p.at).toISOString().slice(0,10)!==file.slice(0,10)){counts.invalid++;continue;}
        const minute=Math.floor(Date.parse(p.at)/60000);
        if(seen.has(minute)){counts.duplicates++;continue;}seen.add(minute);
        rows.push({at:p.at,features,reference:isReference(features)});
        if(!isReference(features))counts.excludedReference++;
      }catch{counts.invalid++;}
    }
  }
  rows.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  let last=-Infinity;counts.overlapping=0;
  const separated=rows.filter(row=>{
    const at=Date.parse(row.at);if(at-last<60000){counts.overlapping++;return false;}last=at;return true;
  });
  return {rows:separated,counts};
}

export class DailyLearning {
  constructor({telemetryDirectory,modelDirectory,source,clock=Date.now}) {
    Object.assign(this,{telemetryDirectory,modelDirectory,source,clock});
    this.bundle=null;this.busy=false;this.lastAttempt=0;this.state={status:'warming-up',lastRun:null};
  }
  async init() {
    await mkdir(this.modelDirectory,{recursive:true});
    this.bundle=await loadBundle(this.modelDirectory,this.source,this.clock());
    try {this.state=JSON.parse(await readFile(path.join(this.modelDirectory,'daily-status.json'),'utf8'));}catch{}
    if(this.state.sourceId!==this.source)this.state={status:'warming-up',lastRun:null};
    return this;
  }
  async run({force=false}={}) {
    if(this.busy)return {status:'already-running'};
    const now=this.clock(),day=new Date(now).toISOString().slice(0,10);
    if(!force&&this.state.lastRun===day)return this.state;
    this.busy=true;this.lastAttempt=now;
    let release;
    try {
      await mkdir(this.modelDirectory,{recursive:true});
      release=await acquireLock(this.modelDirectory);
      if(!release)return {status:'already-running'};
      await runEtl(this.telemetryDirectory,path.join(path.dirname(this.telemetryDirectory),'hourly-report.json'));
      const dataset=await collectDataset(this.telemetryDirectory,this.source,now);
      const days=[...new Set(dataset.rows.map(r=>r.at.slice(0,10)))];
      const testDay=days.at(-1),calDay=days.at(-2);
      const partition=predicate=>dataset.rows.filter(r=>r.reference&&predicate(r.at.slice(0,10)));
      const train=partition(day=>day<calDay),calibration=partition(day=>day===calDay),test=partition(day=>day===testDay);
      const datasetHash=hash(JSON.stringify(dataset.rows));
      const result={sourceId:this.source,lastRun:day,generatedAt:new Date(now).toISOString(),datasetHash,
        counts:dataset.counts,windows:dataset.rows.length,days,split:{train:train.length,calibration:calibration.length,test:test.length},
        status:'insufficient-data',activeVersion:this.bundle?.version||null,
        limitation:'Unsupervised operational reference data, not verified benign labels. No measured attack recall or false-positive rate.'};
      if(days.length>=3&&train.length>=120&&calibration.length>=30&&test.length>=30) {
        const pair=trainPair(train,calibration,test);
        result.evaluation=pair.evaluation;
        // Gate on untouched chronological reference holdout. This is not a security accuracy benchmark.
        if(Object.values(pair.evaluation).every(e=>e.referenceAlertRate<=.1)) {
          const version=hash(`${this.source}:${datasetHash}:local-models-v1`).slice(0,16);
          const bundle={schema:1,sourceId:this.source,version,datasetHash,createdAt:new Date(now).toISOString(),split:result.split,...pair};
          validateBundle(bundle,this.source,now);
          // Content version includes build time so rebuilding a dataset cannot overwrite an active artifact.
          bundle.version=hash(`${version}:${now}`).slice(0,16);
          const artifactFile=path.join(this.modelDirectory,`${bundle.version}.json`);
          await atomicJson(artifactFile,bundle);
          const raw=await readFile(artifactFile,'utf8');
          let registry={};try{registry=JSON.parse(await readFile(path.join(this.modelDirectory,'registry.json'),'utf8'));}catch{}
          const active={version:bundle.version,sha256:hash(raw)};
          await atomicJson(path.join(this.modelDirectory,'registry.json'),{active,previous:registry.active?.version!==active.version?registry.active:registry.previous});
          this.bundle=bundle;result.status='promoted';result.activeVersion=bundle.version;
        } else result.status='quality-gate-rejected';
      }
      await atomicJson(path.join(this.modelDirectory,'daily-status.json'),result);
      this.state=result;return result;
    }catch(error){this.state={...this.state,status:'error',error:error.message};return this.state;}
    finally{if(release)await release();this.busy=false;}
  }
  start() {
    // Startup catch-up, then daily UTC rollover; retry failures at most once per hour.
    const tick=()=>{if(this.clock()-this.lastAttempt>=3600000)this.run();};
    this.run();const timer=setInterval(tick,60000);timer.unref();
    return ()=>clearInterval(timer);
  }
  async rollback() {
    if(this.busy)throw Error('Learning run in progress');
    this.busy=true;
    let release;
    try {
      release=await acquireLock(this.modelDirectory);
      if(!release)throw Error('Another learning process is running');
      const previous=await loadBundle(this.modelDirectory,this.source,this.clock(),'previous');
      if(!previous)throw Error('No valid previous model pair');
      const registry=JSON.parse(await readFile(path.join(this.modelDirectory,'registry.json'),'utf8'));
      await atomicJson(path.join(this.modelDirectory,'registry.json'),{active:registry.previous,previous:registry.active});
      this.bundle=previous;return previous.version;
    }finally{if(release)await release();this.busy=false;}
  }
}
