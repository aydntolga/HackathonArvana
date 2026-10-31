import {createReadStream} from 'node:fs';
import {mkdir,readdir,writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import path from 'node:path';
export async function runEtl(directory,output){
  await mkdir(directory,{recursive:true});
  const hours=new Map();let invalid=0,invalidReviews=0;
  const verdicts=['observe','abstain','escalate','request-more-evidence'];
  const relationships=['consistent','insufficient-evidence','worker-restriction-vetoed','worker-missed-evidence'];
  for(const file of await readdir(directory)){
    if(!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file))continue;
    const lines=createInterface({input:createReadStream(path.join(directory,file)),crlfDelay:Infinity});
    for await(const line of lines){
      try{
        const row=JSON.parse(line);
        if(!Number.isFinite(Date.parse(row.at))||!Number.isFinite(row.requestsPerSecond)||row.requestsPerSecond<0||!Number.isFinite(row.activeRequests)||row.activeRequests<0||!Array.isArray(row.warnings))throw Error('Invalid snapshot');
        const hour=new Date(row.at).toISOString().slice(0,13);
        if(!hours.has(hour))hours.set(hour,{hourUTC:hour,samples:0,sumRps:0,maxRps:0,maxActive:0,warningSamples:0,
          reviewedSamples:0,unreviewedSamples:0,workerVetoSamples:0,workerMissedEvidenceSamples:0,
          reviewVerdicts:Object.fromEntries(verdicts.map(key=>[key,0]))});
        const item=hours.get(hour);item.samples++;item.sumRps+=row.requestsPerSecond;
        item.maxRps=Math.max(item.maxRps,row.requestsPerSecond);item.maxActive=Math.max(item.maxActive,row.activeRequests);item.warningSamples+=row.warnings.length?1:0;
        if(row.review){
          const review=row.review;
          if(review.engine==='local-reviewer-v1'&&review.sourceAt===row.at&&review.action==='observe'&&
            Number.isFinite(Date.parse(review.at))&&Math.abs(Date.parse(review.at)-Date.parse(row.at))<=15000&&
            verdicts.includes(review.verdict)&&relationships.includes(review.relationship)){
            item.reviewedSamples++;item.reviewVerdicts[review.verdict]++;
            item.workerVetoSamples+=review.relationship==='worker-restriction-vetoed'?1:0;
            item.workerMissedEvidenceSamples+=review.relationship==='worker-missed-evidence'?1:0;
          }else{invalidReviews++;item.unreviewedSamples++;}
        }else item.unreviewedSamples++;
      }catch{invalid++;}
    }
  }
  const rows=[...hours.values()].sort((a,b)=>a.hourUTC.localeCompare(b.hourUTC)).map(({sumRps,...item})=>({...item,meanSampledRps:sumRps/item.samples}));
  const result={generatedAt:new Date().toISOString(),invalidLines:invalid,invalidReviews,
    description:'Hourly summaries of available snapshots and matching reviews, not exact request totals, unique incidents, or independent labeled samples',hours:rows};
  await writeFile(output,JSON.stringify(result,null,2));return result;
}
