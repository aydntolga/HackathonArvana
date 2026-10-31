import { WORKER_FEATURES, REVIEWER_FEATURES, extractFeatures } from './model-features.mjs';

const quantile=(values,q)=>{const a=[...values].sort((a,b)=>a-b);return a[Math.min(a.length-1,Math.floor(q*a.length))];};
const vector=(f,model)=>model.features.map((key,i)=>(f[key]-model.center[i])/model.scale[i]);
function fit(rows,features,kind) {
  const center=features.map(key=>quantile(rows.map(r=>r.features[key]),.5));
  const scale=features.map((key,i)=>Math.max(key.startsWith('log')?.15:.02,1.4826*quantile(rows.map(r=>Math.abs(r.features[key]-center[i])),.5)));
  const model={kind,features,center,scale,threshold:1};
  if(kind==='nearest-reference') {
    // Deterministic, bounded reference memory, sampled only from the training partition.
    const step=Math.max(1,Math.ceil(rows.length/256));
    model.references=rows.filter((_,i)=>i%step===0).map(r=>({at:r.at,values:vector(r.features,model)}));
  }
  return model;
}
export function scoreFeatures(f,model) {
  const values=vector(f,model);
  if(model.kind==='robust-distance') {
    const contributions=values.map((value,i)=>({feature:model.features[i],deviation:Math.abs(value)})).sort((a,b)=>b.deviation-a.deviation);
    return {score:contributions[0].deviation,contributors:contributions.slice(0,3)};
  }
  const nearest=model.references.map(r=>({at:r.at,distance:Math.sqrt(values.reduce((sum,x,i)=>sum+(x-r.values[i])**2,0)/values.length)})).sort((a,b)=>a.distance-b.distance).slice(0,3);
  return {score:nearest.reduce((sum,r)=>sum+r.distance,0)/nearest.length,nearestReferences:nearest};
}
export function trainPair(train,calibration,test) {
  const worker=fit(train,WORKER_FEATURES,'robust-distance');
  const reviewer=fit(train,REVIEWER_FEATURES,'nearest-reference');
  const evaluation={};
  for(const [name,model] of Object.entries({worker,reviewer})) {
    model.threshold=Math.max(3,quantile(calibration.map(r=>scoreFeatures(r.features,model).score),.99));
    const flagged=test.filter(r=>scoreFeatures(r.features,model).score>model.threshold).length;
    evaluation[name]={referenceWindows:test.length,flagged,referenceAlertRate:test.length?flagged/test.length:null};
  }
  return {worker,reviewer,evaluation};
}
export function evaluatePulse(pulse,bundle,layer,now=Date.now()) {
  if(!bundle)return {status:'warming-up',trainedModel:false};
  if(now-Date.parse(bundle.createdAt)>7*86400000||Date.parse(bundle.createdAt)>now+60000)return {status:'expired',trainedModel:false};
  const f=extractFeatures(pulse);
  if(!f)return {status:'insufficient-measurements',trainedModel:false};
  const model=bundle[layer],result=scoreFeatures(f,model);
  return {status:'ready',trainedModel:true,version:bundle.version,datasetHash:bundle.datasetHash,
    method:model.kind,...result,threshold:model.threshold,unusual:result.score>model.threshold,
    interpretation:'Distance from an operational reference cohort; not an attack probability'};
}
