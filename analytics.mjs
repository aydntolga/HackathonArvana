import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';

export function proportion(success,total){
  if(!total)return {value:null,total:0,success,interval:null};
  const p=success/total,z=1.96,d=1+z*z/total;
  const center=(p+z*z/(2*total))/d,margin=z*Math.sqrt(p*(1-p)/total+z*z/(4*total*total))/d;
  return {value:p,total,success,interval:[Math.max(0,center-margin),Math.min(1,center+margin)]};
}
export function summarizeRun(report){
  const matrix={tp:0,tn:0,fp:0,fn:0};let excluded=0,abstainingCustomers=0;
  for(const r of report.results||[]){
    if(!['local-http-flood-overload','legitimate-usage'].includes(r.expectedScenario)||typeof r.reviewerEscalated!=='boolean'){excluded++;continue;}
    const positive=r.expectedScenario==='local-http-flood-overload';
    matrix[positive?(r.reviewerEscalated?'tp':'fn'):(r.reviewerEscalated?'fp':'tn')]++;
    if(r.events?.some(e=>e.verdict==='abstain'))abstainingCustomers++;
  }
  const {tp,tn,fp,fn}=matrix;
  return {matrix,excluded,abstainingCustomers,
    accuracy:proportion(tp+tn,tp+tn+fp+fn),precision:proportion(tp,tp+fp),recall:proportion(tp,tp+fn),falseAlarmRate:proportion(fp,fp+tn),
    unit:'One customer scenario; positive prediction = at least one reviewer health escalation',
    limitation:'Descriptive scenario agreement, not learned-model or production attack accuracy. No escalation includes abstention, not a verified benign classification. Wilson intervals illustrate sample-size uncertainty under an independence assumption; these scripted scenarios are not a representative independent sample.'};
}
export async function loadAnalytics(directory){
  let names;try{names=(await readdir(directory)).filter(n=>/^\d+$/.test(n)).sort((a,b)=>Number(b)-Number(a));}catch{return {status:'no-runs',runs:[],customers:[]};}
  const runs=[];
  for(const name of names.slice(0,20)){
    try{
      const filename=path.join(directory,name,'report.json');if((await stat(filename)).size>4*1024*1024)continue;
      const report=JSON.parse(await readFile(filename,'utf8'));
      if(!Array.isArray(report.results)||report.results.length>100||!Number.isFinite(Date.parse(report.at)))continue;
      runs.push({id:name,at:report.at,passed:report.passed,report});
    }catch{}
  }
  if(!runs.length)return {status:'no-completed-runs',runs:[],customers:[]};
  // Latest run, including failures. Never cherry-pick a passing report.
  const selected=runs[0],customers=[];
  for(const r of selected.report.results){
    if(!/^[a-z0-9-]+$/.test(r.id))continue;
    const samples=[],folder=path.join(directory,selected.id,r.id,'telemetry');
    const events=(r.events||[]).filter(e=>Number.isFinite(Date.parse(e.at)));
    const start=events[0]?Date.parse(events[0].at)-5000:0,end=Date.parse(selected.at);
    try{
      for(const file of (await readdir(folder)).filter(n=>/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).sort().slice(-8)){
        const filename=path.join(folder,file);if((await stat(filename)).size>16*1024*1024)continue;
        for(const line of (await readFile(filename,'utf8')).split('\n')){
          try{const p=JSON.parse(line),time=Date.parse(p.at);
            if(time<start||time>end||!Number.isFinite(time)||!Number.isFinite(p.requestsPerSecond)||!p.window)continue;
            const phase=events.findLast(e=>Date.parse(e.at)<=time)?.phase||'baseline';
            samples.push({at:p.at,phase,rps:p.requestsPerSecond,active:p.activeRequests,completed:p.window.completed,
              successful:p.window.successful,errors:p.window.errors,authFailures:p.window.authFailures,
              latency:p.p95LifecycleMsUpperBound,verdict:p.review?.verdict||'unknown',diagnosis:p.review?.diagnosis||'unknown'});
          }catch{}
        }
      }
    }catch{}
    samples.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
    customers.push({...r,samples:samples.slice(-500)});
  }
  let measurement=null;
  try{measurement=JSON.parse(await readFile(path.join(directory,'..','measurement','report.json'),'utf8'));}catch{}
  const research={};
  for(const [key,file] of Object.entries({known:'report.json',unseen:'unseen-lexical/report.json',runtime:'runtime-validation.json'})){
    try{research[key]=JSON.parse(await readFile(path.join(directory,'..','http-research',file),'utf8'));}catch{}
  }
  return {status:'ready',measurement,research,run:{id:selected.id,at:selected.at,passed:selected.passed,checks:selected.report.checks,maxSamplingGapMs:selected.report.maxSamplingGapMs},
    runs:runs.map(({report,...r})=>r),metrics:summarizeRun(selected.report),customers,
    provenance:'Recorded local HTTP experiment. Not a live production feed. Five-second snapshots contain overlapping 60-second windows; request totals come from the generator report.'};
}
