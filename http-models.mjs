import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {extractHttpFeatures,HTTP_FEATURES,httpModelText} from './http-features.mjs';

export function forestScore(features,model,text=''){
  if(model.kind==='linear-tfidf'){
    const counts=new Map();
    for(let size=model.ngram[0];size<=model.ngram[1];size++)for(let i=0;i<=text.length-size;i++){
      const gram=text.slice(i,i+size);if(Object.hasOwn(model.vocabulary,gram)){const index=model.vocabulary[gram];counts.set(index,(counts.get(index)||0)+1);}
    }
    let sum=0,square=0;
    for(const [index,count] of counts){const value=(1+Math.log(count))*model.idf[index];sum+=value*model.coef[index];square+=value*value;}
    let linear=model.intercept+(square?sum/Math.sqrt(square):0);
    model.indices.forEach((index,i)=>{linear+=Math.fround(features[index])/model.numericScale[i]*model.numericCoef[i];});
    return 1/(1+Math.exp(-Math.max(-700,Math.min(700,linear))));
  }
  const x=model.indices.map(i=>Math.fround(features[i]));let total=0;
  for(const t of model.trees){let node=0,steps=0;
    while(t.left[node]!==-1){if(++steps>64)throw Error('Invalid tree depth');node=x[t.feature[node]]<=t.threshold[node]?t.left[node]:t.right[node];}
    total+=t.probability[node];
  }return total/model.trees.length;
}
export async function loadHttpModels(directory){
  try{
    const file=path.join(directory,'model-pair.json');if((await stat(file)).size>32*1024*1024)throw Error('Oversized model');
    const raw=await readFile(file,'utf8'),report=JSON.parse(await readFile(path.join(directory,'report.json'),'utf8'));
    if(createHash('sha256').update(raw).digest('hex')!==report.modelSha256)throw Error('Model checksum mismatch');
    const b=JSON.parse(raw);
    if(b.schema!==1||b.task!=='http-request-anomaly'||b.version!==report.modelVersion||JSON.stringify(b.features)!==JSON.stringify(HTTP_FEATURES))throw Error('Schema mismatch');
    for(const model of [b.worker,b.reviewer]){
      if(model.kind==='linear-tfidf'){
        const n=model.coef?.length;
        if(!n||n>50000||!Array.isArray(model.idf)||model.idf.length!==n||model.coef.some(x=>!Number.isFinite(x))||model.idf.some(x=>!Number.isFinite(x)||x<=0)||!Number.isFinite(model.intercept)||!Number.isFinite(model.threshold)||model.threshold<0||model.threshold>1.00001||!Array.isArray(model.ngram)||model.ngram.length!==2||model.ngram[0]<1||model.ngram[1]>5||model.ngram[1]<model.ngram[0])throw Error('Invalid lexical model');
        if(!model.vocabulary||Object.keys(model.vocabulary).length!==n||Object.entries(model.vocabulary).some(([key,v])=>key.length<model.ngram[0]||key.length>model.ngram[1]||!Number.isInteger(v)||v<0||v>=n)||new Set(Object.values(model.vocabulary)).size!==n)throw Error('Invalid vocabulary');
        if(!Array.isArray(model.indices)||!model.indices.length||model.indices.some(i=>!Number.isInteger(i)||i<0||i>=HTTP_FEATURES.length)||!Array.isArray(model.numericCoef)||model.numericCoef.length!==model.indices.length||model.numericCoef.some(x=>!Number.isFinite(x))||!Array.isArray(model.numericScale)||model.numericScale.length!==model.indices.length||model.numericScale.some(x=>!Number.isFinite(x)||x<=0))throw Error('Invalid structural weights');
        continue;
      }
      if(model.kind!=='numeric-forest'||!Array.isArray(model.indices)||!model.indices.length||model.indices.some(i=>!Number.isInteger(i)||i<0||i>=HTTP_FEATURES.length)||!Number.isFinite(model.threshold)||model.threshold<0||model.threshold>1.00001||!Array.isArray(model.trees)||!model.trees.length||model.trees.length>128)throw Error('Invalid forest');
      for(const t of model.trees){
        const n=t.left?.length;if(!n||n>65536||['right','feature','threshold','probability'].some(k=>!Array.isArray(t[k])||t[k].length!==n))throw Error('Invalid tree');
        for(let i=0;i<n;i++){
          if(!Number.isFinite(t.probability[i])||t.probability[i]<0||t.probability[i]>1||!Number.isFinite(t.threshold[i]))throw Error('Invalid score');
          if(t.left[i]!==-1&&(!Number.isInteger(t.left[i])||!Number.isInteger(t.right[i])||t.left[i]<=i||t.right[i]<=i||t.left[i]>=n||t.right[i]>=n||!Number.isInteger(t.feature[i])||t.feature[i]<0||t.feature[i]>=model.indices.length))throw Error('Invalid tree edge');
        }
      }
    }return b;
  }catch{return null;}
}
export class HttpInspector{
  constructor(bundle){this.bundle=bundle;this.total=0;this.workerFlags=0;this.reviewerFlags=0;this.disagreements=0;this.abstentions=0;this.recent=[];}
  observe(request,{truncated=false,partial=false}={}){
    this.total++;
    if(!this.bundle||truncated||partial){this.abstentions++;return {action:'observe',status:!this.bundle?'model-unavailable':'incomplete-input'};}
    try{
      const x=extractHttpFeatures(request),text=httpModelText(request),workerScore=forestScore(x,this.bundle.worker,text),reviewerScore=forestScore(x,this.bundle.reviewer,text);
      const workerFlag=workerScore>=this.bundle.worker.threshold,reviewerFlag=reviewerScore>=this.bundle.reviewer.threshold;
      this.workerFlags+=workerFlag?1:0;this.reviewerFlags+=reviewerFlag?1:0;this.disagreements+=workerFlag!==reviewerFlag?1:0;
      const decision={at:new Date().toISOString(),version:this.bundle.version,workerScore,reviewerScore,workerFlag,reviewerFlag,
        relationship:workerFlag===reviewerFlag?'agreement':workerFlag?'worker-flag-not-confirmed':'reviewer-found-additional-evidence',action:'observe',
        interpretation:'CSIC-style HTTP request anomaly scores, not calibrated attack probabilities or DDoS attribution'};
      if(workerFlag||reviewerFlag){this.recent.push(decision);this.recent=this.recent.slice(-20);}return decision;
    }catch{this.abstentions++;return {status:'model-error',action:'observe'};}
  }
  snapshot(){return {enabled:Boolean(this.bundle),version:this.bundle?.version||null,total:this.total,workerFlags:this.workerFlags,reviewerFlags:this.reviewerFlags,disagreements:this.disagreements,abstentions:this.abstentions,recent:structuredClone(this.recent),mode:'observe'};}
}
