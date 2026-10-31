// Reproducible two-transfer evaluation. Synthetic telemetry, never production history.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {extractFeatures,isReference} from './model-features.mjs';
import {trainPair,evaluatePulse} from './local-models.mjs';
import {LocalReviewer} from './local-reviewer.mjs';
import {proportion} from './analytics.mjs';

const hash=s=>createHash('sha256').update(s).digest('hex');
function random(seed){return ()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};}
function makeBatch(seed,count,start,{incidents=false}={}){
  const rng=random(seed),rows=[];
  for(let i=0;i<count;i++){
    const u=rng();let cohort=u<.55?'ordinary':u<.7?'slow-success':u<.85?'legitimate-campaign':'login-retries';
    if(incidents&&i%2===0)cohort=i%4===0?'server-errors':'transport-degradation';
    const rps=cohort==='legitimate-campaign'?15+rng()*45:.5+rng()*7.5;
    const n=Math.round(rps*60),started=n,active=Math.floor(rng()*5);
    let errors=0,authFailures=0,upstreamErrors=0;
    if(cohort==='server-errors')errors=Math.ceil(n*(.12+rng()*.48));
    if(cohort==='transport-degradation'){upstreamErrors=Math.max(3,Math.ceil(n*(.03+rng()*.2)));errors=upstreamErrors;}
    if(cohort==='login-retries')authFailures=Math.ceil(n*(.08+rng()*.32));
    const latency=cohort==='slow-success'?10000:[100,250,500][Math.floor(rng()*3)];
    const bins=[50,100,250,500,1000,2500,5000,10000,30000,Infinity],histogram=bins.map(()=>0);histogram[bins.indexOf(latency)]=n;
    const at=new Date(start+i*60000).toISOString();
    rows.push({id:`${seed}-${i}`,cohort,expectedIncident:['server-errors','transport-degradation'].includes(cohort),
      provenance:'synthetic-replay',at,windowSeconds:60,requestsPerSecond:Number((started/60).toFixed(2)),activeRequests:active,
      p95LifecycleMsUpperBound:latency,window:{started,completed:n,successful:n-errors-authFailures,errors,authFailures,missing:0,aborted:0,upstreamErrors,histogram},
      baseline:{samples:5,medianRps:rps,state:'ready'},proposal:{type:'no-anomaly',suggestedAction:'observe'}});
  }return rows;
}
async function transfer(file,rows){
  const raw=rows.map(JSON.stringify).join('\n')+'\n';await writeFile(file,raw);
  const loaded=(await readFile(file,'utf8')).trim().split('\n').map(JSON.parse),accepted=[],seen=new Set();let rejected=0;
  for(const row of loaded){const features=extractFeatures(row);if(!features||seen.has(row.id)){rejected++;continue;}seen.add(row.id);accepted.push({...row,features});}
  return {rows:accepted,sha256:hash(raw),received:loaded.length,accepted:accepted.length,rejected};
}
function confusion(rows,predict){
  const matrix={tp:0,tn:0,fp:0,fn:0};
  for(const row of rows)matrix[row.expectedIncident?(predict(row)?'tp':'fn'):(predict(row)?'fp':'tn')]++;
  const {tp,tn,fp,fn}=matrix;
  return {matrix,accuracy:proportion(tp+tn,rows.length),precision:proportion(tp,tp+fp),recall:proportion(tp,tp+fn),falseAlarmRate:proportion(fp,fp+tn)};
}
export async function measureModels(directory=fileURLToPath(new URL('./data/measurement/',import.meta.url))){
  await mkdir(directory,{recursive:true});
  const now=Date.now();
  const protocol={version:1,target:'Operational service incident: server-error or transport-degradation cohort',
    prediction:'Raw model novelty above its frozen threshold; separate final reviewer policy is also reported',
    provenance:'Deterministic synthetic telemetry windows, not collected customer days. Event timestamps are simulated ordering.',
    trainingSeed:104729,secondTransferSeed:130363,trainingCount:2000,calibrationCount:500,testCount:2000,
    labelRule:'Generated server-error and transport-degradation cohorts are positive. Ordinary, slow-success, legitimate-campaign and login-retries are negative.',
    noTuning:'Targets and seeds fixed before scoring. No threshold changes based on test outcomes.',
    desiredReleaseTargets:{incidentRecall:.95,healthyFalseAlarmRate:.01,detectionP95Ms:5000},
    releaseStatus:'Targets, not achieved production guarantees. Representative independent labeled customer data still required.'};
  await writeFile(path.join(directory,'protocol.json'),JSON.stringify(protocol,null,2));
  const batchA=makeBatch(protocol.trainingSeed,2000,now-4500*60000);
  const calibration=makeBatch(protocol.secondTransferSeed,500,now-2500*60000);
  const test=makeBatch(protocol.secondTransferSeed+1,2000,now-2000*60000,{incidents:true});
  const first=await transfer(path.join(directory,'transfer-1.jsonl'),batchA);
  const second=await transfer(path.join(directory,'transfer-2.jsonl'),[...calibration,...test]);
  const train=first.rows.filter(r=>isReference(r.features));
  const cal=second.rows.slice(0,500).filter(r=>isReference(r.features));
  const holdout=second.rows.slice(500);
  const pair=trainPair(train,cal,[]);
  // No test labels or test measurements are used to fit or calibrate either model.
  const datasetHash=hash(first.sha256+second.sha256),version=datasetHash.slice(0,16);
  const bundle={schema:1,sourceId:'synthetic-evaluation-only',version,datasetHash,createdAt:new Date(now).toISOString(),worker:pair.worker,reviewer:pair.reviewer};
  await writeFile(path.join(directory,'test-model-pair.json'),JSON.stringify(bundle,null,2));
  // Score the serialized/reloaded pair, not an unpersisted training object.
  const loaded=JSON.parse(await readFile(path.join(directory,'test-model-pair.json'),'utf8'));
  const scored=holdout.map(row=>{
    const {cohort,expectedIncident,features,id,provenance,...measurements}=row;
    const pulse={...measurements,at:new Date(now).toISOString()};
    const worker=evaluatePulse(pulse,loaded,'worker',now),reviewer=evaluatePulse(pulse,loaded,'reviewer',now);
    pulse.model=worker;pulse.proposal={type:worker.unusual?'anomaly-observed':'no-anomaly',suggestedAction:'observe'};
    const audit=new LocalReviewer({clock:()=>now,modelProvider:()=>loaded}).review(pulse);
    return {...row,workerNovel:worker.unusual,reviewerNovel:reviewer.unusual,policyEscalated:audit.verdict==='escalate',policyVerdict:audit.verdict};
  });
  const metrics={worker:confusion(scored,r=>r.workerNovel),reviewer:confusion(scored,r=>r.reviewerNovel),reviewerPolicy:confusion(scored,r=>r.policyEscalated)};
  const cohorts=[...new Set(scored.map(r=>r.cohort))].map(cohort=>{const rows=scored.filter(r=>r.cohort===cohort);return {cohort,count:rows.length,expectedIncident:rows[0].expectedIncident,workerAlerts:rows.filter(r=>r.workerNovel).length,reviewerAlerts:rows.filter(r=>r.reviewerNovel).length,policyEscalations:rows.filter(r=>r.policyEscalated).length,policyAbstentions:rows.filter(r=>r.policyVerdict==='abstain').length};});
  const report={at:new Date(now).toISOString(),status:'evaluated',testModelVersion:version,protocol,
    transfers:[{batch:1,received:first.received,accepted:first.accepted,rejected:first.rejected,sha256:first.sha256},{batch:2,received:second.received,accepted:second.accepted,rejected:second.rejected,sha256:second.sha256}],
    split:{train:train.length,calibration:cal.length,test:holdout.length},metrics,cohorts,
    targetChecks:Object.fromEntries(['worker','reviewer'].map(name=>[name,{recall:metrics[name].recall.value>=.95,falseAlarmRate:metrics[name].falseAlarmRate.value<=.01,met:metrics[name].recall.value>=.95&&metrics[name].falseAlarmRate.value<=.01}])),
    limitations:['Synthetic evaluation, not production accuracy or real DDoS detection.','Raw novelty models are evaluated as incident candidates; novelty is not malicious intent.','Final reviewer includes deterministic safeguards, so its score must not be attributed to learned weights alone.','Single generator and fixed seeds; correlated scenario families limit generalization.','Test model pair is isolated and is not promoted into production.']};
  await writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const report=await measureModels();console.log(JSON.stringify(report,null,2));
}
