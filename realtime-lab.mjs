import http from 'node:http';
import {once} from 'node:events';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {FirstAgent} from './first-agent.mjs';
import {LocalReviewer} from './local-reviewer.mjs';
import {createObservedProxy} from './proxy.mjs';
import {startTelemetry} from './telemetry.mjs';
import {runEtl} from './etl-core.mjs';
import {DailyLearning} from './daily-learning.mjs';
import {sourceId} from './model-features.mjs';

export const CUSTOMERS=[
  {id:'shop',name:'Harbor Store',profile:'Product browsing and checkout'},
  {id:'news',name:'Morning News',profile:'Article and feed requests'},
  {id:'docs',name:'Atlas Docs',profile:'Documentation and search'},
  {id:'booking',name:'City Booking',profile:'Availability and reservation POSTs'},
  {id:'slow',name:'Rural Connect',profile:'Successful six-second responses; slow-user protection'},
  {id:'retries',name:'Member Portal',profile:'Repeated login attempts mixed with successful requests'},
  {id:'campaign',name:'Launch Store',profile:'Healthy flash crowd at the same offered burst rate'},
  {id:'overload',name:'Small Ticket Office',profile:'Controlled HTTP flood simulation against limited local capacity'}
];
export function createCustomerSite(customer) {
  let active=0;
  return http.createServer((req,res)=>{
    req.resume();
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/'){
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>${customer.name}</title><style>body{font:18px system-ui;background:#101726;color:#e4eaf7;max-width:780px;margin:60px auto;padding:24px}a{color:#a9caff}button{padding:12px}</style><h1>${customer.name}</h1><p>Fictional local customer / Server Doctor testing lab</p><p>${customer.profile}</p><button onclick="fetch('/api/items').then(r=>r.json()).then(x=>document.querySelector('pre').textContent=JSON.stringify(x,null,2))">Load live API data</button><pre></pre><p><a href="http://localhost:3010">Monitoring dashboard</a></p></html>`);return;
    }
    if(customer.id==='overload'&&active>=2){res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"Local capacity exhausted"}');return;}
    active++;
    let ended=false;
    const finish=()=>{if(!ended){ended=true;active--;}};
    res.once('close',finish);
    const wait=customer.id==='slow'?6000:customer.id==='overload'?250:15;
    const timer=setTimeout(()=>{
      const status=pathname==='/api/login'?401:200;
      res.writeHead(status,{'Content-Type':'application/json'});
      res.end(JSON.stringify({customer:customer.id,method:req.method,status,items:['Sample item'],at:new Date().toISOString()}));finish();
    },wait);
    res.once('close',()=>clearTimeout(timer));
  });
}
async function listen(server,port=0){server.listen(port,'127.0.0.1');await once(server,'listening');return `http://127.0.0.1:${server.address().port}`;}
export async function localRequest(url,{method='GET'}={}){
  const target=new URL(url);
  if(target.protocol!=='http:'||target.hostname!=='127.0.0.1'||target.username||target.password)throw Error('Lab traffic is restricted to literal IPv4 loopback');
  const response=await fetch(url,{method,body:method==='POST'?'{}':undefined,
    headers:method==='POST'?{'Content-Type':'application/json'}:{},redirect:'error',signal:AbortSignal.timeout(10000)});
  await response.arrayBuffer();return response.status;
}
export async function startLab({serve=false,directory=fileURLToPath(new URL(`./data/realtime-lab/${Date.now()}/`,import.meta.url)),dashboardPort=3010}={}){
  await mkdir(directory,{recursive:true});
  const customers=[],servers=[],timers=[],pending=new Set();
  let phase='starting',finished=false,report=null,etlBusy=false,maxSamplingGapMs=0,lastSample=Date.now();
  const begun=Date.now();
  async function close(){for(const timer of timers)clearInterval(timer);for(const c of customers){c.writer.stop();c.stopLearning?.();}await Promise.allSettled([...pending]);await Promise.all(servers.map(s=>new Promise(r=>{s.closeAllConnections();s.close(r);})) );}
  try{
    for(const customer of CUSTOMERS){
      const folder=path.join(directory,customer.id),source=sourceId(`local-lab:${customer.id}`);
      const learning=await new DailyLearning({telemetryDirectory:path.join(folder,'telemetry'),modelDirectory:path.join(folder,'models'),source}).init();
      const agent=new FirstAgent({modelProvider:()=>learning.bundle}),reviewer=new LocalReviewer({modelProvider:()=>learning.bundle});
      const origin=createCustomerSite(customer);servers.push(origin);const target=await listen(origin);
      const proxy=createObservedProxy({target,agent});servers.push(proxy);const url=await listen(proxy);
      // One ETL-owned flush cadence avoids duplicate competing telemetry timers.
      const writer=startTelemetry(agent,path.join(folder,'telemetry'),{intervalMs:0,reviewer,source});
      customers.push({...customer,folder,source,url,agent,reviewer,writer,learning,inFlight:0,sent:0,completed:0,transportErrors:0,errors:[],statuses:{},maxInFlight:0,latencies:[],events:[],etl:null});
    }
    function state(){return {startedAt:new Date(begun).toISOString(),phase,finished,elapsedSeconds:Math.floor((Date.now()-begun)/1000),
      provenance:'Fictional customers, actual loopback HTTP requests, wall-clock time. No public sites or real distributed attack.',
      report,customers:customers.map(c=>({id:c.id,name:c.name,profile:c.profile,url:c.url,sent:c.sent,completed:c.completed,
        transportErrors:c.transportErrors,statuses:c.statuses,pulse:c.agent.snapshot(),review:c.reviewer.latest,
        etl:c.etl,learning:c.learning.state}))};}
    const dashboard=http.createServer(async(req,res)=>{
      if(req.url==='/api/lab'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(state()));return;}
      if(req.url!=='/'){res.writeHead(404);res.end();return;}
      res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await readFile(new URL('./lab.html',import.meta.url),'utf8'));
    });servers.push(dashboard);const dashboardUrl=await listen(dashboard,dashboardPort);
    console.log(JSON.stringify({dashboard:dashboardUrl,directory,customers:customers.map(c=>({id:c.id,url:c.url})),durationSeconds:115}));
    const sample=()=>{const now=Date.now();if(!finished)maxSamplingGapMs=Math.max(maxSamplingGapMs,now-lastSample);lastSample=now;
      for(const c of customers){const pulse=c.agent.snapshot(),review=c.reviewer.review(pulse);
      c.events.push({at:pulse.at,phase,workerAnomaly:pulse.proposal.type==='anomaly-observed',verdict:review.verdict,diagnosis:review.diagnosis,action:review.action,modelStatus:review.model?.status||'unavailable'});
      if(c.events.length>240)c.events.shift();}};
    timers.push(setInterval(sample,1000));
    async function refreshEtl(){
      if(etlBusy)return;etlBusy=true;
      try{for(const c of customers){await c.writer.flush();c.etl=await runEtl(path.join(c.folder,'telemetry'),path.join(c.folder,'hourly.json'));}}
      finally{etlBusy=false;}
    }
    timers.push(setInterval(()=>refreshEtl().catch(e=>console.error('ETL error:',e.message)),5000));
    for(const c of customers){
      let last=0;
      timers.push(setInterval(()=>{
        if(finished)return;
        const burst=phase==='burst'&&['overload','campaign'].includes(c.id);
        const gap=burst?63:c.id==='docs'?500:1000;
        if(Date.now()-last<gap||c.inFlight>=8||c.sent>=1200)return;
        last=Date.now();c.sent++;c.inFlight++;c.maxInFlight=Math.max(c.maxInFlight,c.inFlight);
        const pathname=c.id==='retries'&&c.sent%4===0?'/api/login':'/api/items';
        const began=performance.now();
        const task=localRequest(c.url+pathname,{method:c.id==='booking'?'POST':'GET'}).then(status=>{
          c.completed++;c.statuses[status]=(c.statuses[status]||0)+1;c.latencies.push(Math.round(performance.now()-began));
        }).catch(error=>{c.transportErrors++;c.errors.push({at:new Date().toISOString(),phase,type:error.name,code:error.cause?.code||null});}).finally(()=>{c.inFlight--;pending.delete(task);});pending.add(task);
      },20));
    }
    phase='baseline';console.log('Phase: baseline (25 seconds)');await delay(25000);
    phase='burst';const burstAt=Date.now();console.log('Phase: controlled local burst + healthy campaign (25 seconds)');await delay(25000);
    phase='recovery';console.log('Phase: recovery (65 seconds; drain the 60-second detector window)');await delay(65000);
    finished=true;for(const timer of timers)clearInterval(timer);
    await Promise.allSettled([...pending]);sample();
    for(const c of customers)c.writer.stop();
    while(etlBusy)await delay(20);await refreshEtl();
    const results=[];
    for(const c of customers){
      // Replay persisted ETL inputs independently; scenario labels never enter either detector.
      const records=[];
      for(const file of (await readdir(path.join(c.folder,'telemetry'))).filter(f=>/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort()){
        const raw=await readFile(path.join(c.folder,'telemetry',file),'utf8');
        records.push(...raw.trim().split('\n').filter(Boolean).map(JSON.parse));
      }
      const replay=records.map(row=>new LocalReviewer({clock:()=>Date.parse(row.at),modelProvider:()=>c.learning.bundle}).review(row));
      const learning=await c.learning.run();
      const incident=c.events.find(e=>Date.parse(e.at)>=burstAt&&e.diagnosis==='service-health-incident');
      const latest=c.reviewer.latest;
      results.push({id:c.id,name:c.name,expectedScenario:c.id==='overload'?'local-http-flood-overload':'legitimate-usage',
        sent:c.sent,completed:c.completed,statuses:c.statuses,transportErrors:c.transportErrors,errors:c.errors,maxInFlight:c.maxInFlight,
        p95RequestMs:c.latencies.sort((a,b)=>a-b)[Math.min(c.latencies.length-1,Math.floor(c.latencies.length*.95))],
        workerFlagged:c.events.some(e=>e.workerAnomaly),reviewerEscalated:c.events.some(e=>e.verdict==='escalate'),
        detectionDelayMs:incident?Date.parse(incident.at)-burstAt:null,recovered:latest.diagnosis!=='service-health-incident',
        restrictionCount:c.events.filter(e=>e.action!=='observe').length,
        etlSamples:c.etl.hours.reduce((n,h)=>n+h.samples,0),reviewedEtlSamples:c.etl.hours.reduce((n,h)=>n+h.reviewedSamples,0),
        persistedReplayEscalated:replay.some(r=>r.verdict==='escalate'),sourceIsolated:records.every(r=>r.sourceId===c.source),
        invalidEtlRecords:c.etl.invalidLines+c.etl.invalidReviews,learningStatus:learning.status,events:structuredClone(c.events)});
    }
    const affected=results.find(c=>c.id==='overload'),healthy=results.filter(c=>c.id!=='overload');
    const checks={continuousSampling:maxSamplingGapMs<5000,eightCustomers:results.length===8,allRequestsAccounted:results.every(c=>c.sent===c.completed&&c.transportErrors===0),
      healthyNoEscalations:healthy.every(c=>!c.reviewerEscalated),noRestrictions:results.every(c=>c.restrictionCount===0),
      overloadedCustomerDetected:affected.workerFlagged&&affected.reviewerEscalated&&affected.persistedReplayEscalated,
      recovered:affected.recovered,etlComplete:results.every(c=>c.etlSamples>0&&c.etlSamples===c.reviewedEtlSamples&&c.invalidEtlRecords===0),
      sourceIsolation:results.every(c=>c.sourceIsolated)};
    report={at:new Date().toISOString(),passed:Object.values(checks).every(Boolean),maxSamplingGapMs,checks,results,
      scope:'Actual local HTTP integration with simulated customers and a bounded single-host overload. Detection means a health anomaly, not proven DDoS attribution. Learned models stay untrained until qualifying closed days exist. No production accuracy claim.'};
    await writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));
    phase='complete';console.log(JSON.stringify({passed:report.passed,checks,results:results.map(({events,...r})=>r),report:path.join(directory,'report.json')},null,2));
    if(!serve)await close();
    else {
      for(const c of customers)c.stopLearning=c.learning.start();
      timers.push(setInterval(()=>{sample();refreshEtl().catch(e=>console.error('ETL error:',e.message));},5000));
    }
    return {report,directory,close,dashboardUrl};
  }catch(error){await close();throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await startLab({serve:process.argv.includes('--serve')});
  if(!result.report.passed)process.exitCode=1;
  if(process.argv.includes('--serve')){process.once('SIGINT',()=>result.close());process.once('SIGTERM',()=>result.close());}
}
