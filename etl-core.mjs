import {createReadStream} from 'node:fs';
import {mkdir,readdir,writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import path from 'node:path';
export async function runEtl(directory,output){
  await mkdir(directory,{recursive:true});
  const hours=new Map();let invalid=0;
  for(const file of await readdir(directory)){
    if(!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file))continue;
    const lines=createInterface({input:createReadStream(path.join(directory,file)),crlfDelay:Infinity});
    for await(const line of lines){
      try{
        const row=JSON.parse(line);
        if(!Number.isFinite(Date.parse(row.at))||!Number.isFinite(row.requestsPerSecond)||row.requestsPerSecond<0||!Number.isFinite(row.activeRequests)||row.activeRequests<0||!Array.isArray(row.warnings))throw Error('Invalid snapshot');
        const hour=new Date(row.at).toISOString().slice(0,13);
        if(!hours.has(hour))hours.set(hour,{hourUTC:hour,samples:0,sumRps:0,maxRps:0,maxActive:0,warningSamples:0});
        const item=hours.get(hour);item.samples++;item.sumRps+=row.requestsPerSecond;
        item.maxRps=Math.max(item.maxRps,row.requestsPerSecond);item.maxActive=Math.max(item.maxActive,row.activeRequests);item.warningSamples+=row.warnings.length?1:0;
      }catch{invalid++;}
    }
  }
  const rows=[...hours.values()].sort((a,b)=>a.hourUTC.localeCompare(b.hourUTC)).map(({sumRps,...item})=>({...item,meanSampledRps:sumRps/item.samples}));
  const result={generatedAt:new Date().toISOString(),invalidLines:invalid,description:'Hourly summaries of available snapshots, not exact traffic totals or labeled training data',hours:rows};
  await writeFile(output,JSON.stringify(result,null,2));return result;
}
