// Opt-in, bounded integration check. Four normal requests, no load or attack traffic.
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {FirstAgent} from './first-agent.mjs';
import {LocalReviewer} from './local-reviewer.mjs';
import {createObservedProxy} from './proxy.mjs';
import {startTelemetry} from './telemetry.mjs';
import {runEtl} from './etl-core.mjs';

const target='https://httpbin.org';
const directory=fileURLToPath(new URL(`./data/external-validation/${Date.now()}/`,import.meta.url));
await mkdir(directory,{recursive:true});
const agent=new FirstAgent(),reviewer=new LocalReviewer();
const proxy=createObservedProxy({target,agent});proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
const writer=startTelemetry(agent,path.join(directory,'telemetry'),{reviewer});
const cases=[
  {name:'normal-get',path:'/get',status:200},
  {name:'normal-post',path:'/post',status:200,method:'POST',body:JSON.stringify({source:'server-doctor-demo',scenario:'normal'})},
  {name:'delayed-response',path:'/delay/1',status:200},
  {name:'declared-server-error',path:'/status/503',status:503}
];
const results=[];
try{
  for(const scenario of cases){
    const began=performance.now();
    try{
      const response=await fetch(`http://127.0.0.1:${proxy.address().port}${scenario.path}`,{
        method:scenario.method||'GET',body:scenario.body,headers:scenario.body?{'Content-Type':'application/json'}:{},
        signal:AbortSignal.timeout(15000),redirect:'manual'
      });
      await response.arrayBuffer(); // Never retain echoed request data or public IP information.
      results.push({name:scenario.name,expectedStatus:scenario.status,status:response.status,passed:response.status===scenario.status,durationMs:Math.round(performance.now()-began)});
      if(response.status===429)break; // Respect provider limits; no automatic retries.
    }catch(error){results.push({name:scenario.name,passed:false,error:error.name,durationMs:Math.round(performance.now()-began)});}
    await delay(1000);
  }
  await writer.flush();
  const etl=await runEtl(path.join(directory,'telemetry'),path.join(directory,'hourly.json'));
  const pulse=agent.snapshot();
  const passed=results.length===cases.length&&results.every(r=>r.passed)&&pulse.completedRequests===4&&pulse.activeRequests===0&&
    pulse.window.upstreamErrors===0&&writer.state.lastError===null&&etl.hours[0]?.reviewedSamples===1;
  const report={at:new Date().toISOString(),target,passed,requestCount:results.length,cases:results,pulse,review:reviewer.latest,etl,
    scope:'Functional integration only. Four normal requests do not measure detection accuracy, false-positive rate, or load capacity.'};
  await writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed,cases:results,requests:pulse.totalRequests,upstreamErrors:pulse.window.upstreamErrors,
    review:reviewer.latest?.verdict,reviewedEtlSamples:etl.hours[0]?.reviewedSamples,report:path.join(directory,'report.json')},null,2));
  if(!passed)process.exitCode=1;
}finally{writer.stop();proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}
