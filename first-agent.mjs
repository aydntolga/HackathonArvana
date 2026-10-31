import { randomBytes, createHmac } from 'node:crypto';
import { evaluatePulse } from './local-models.mjs';

const LIMITS = [50,100,250,500,1000,2500,5000,10000,30000,Infinity];
const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)] || 0;
export class FirstAgent {
  constructor({clock=Date.now, maxClients=2000,modelProvider=()=>null}={}) {
    this.modelProvider=modelProvider;
    this.clock=clock; this.started=clock(); this.maxClients=maxClients;
    this.buckets=new Map(); this.clients=new Map(); this.baseline=[];
    this.active=0; this.total=0; this.completed=0; this.evictions=0;
    this.salt=randomBytes(32); this.lastBaselineAt=this.started;
  }
  bucket() {
    this.prune();
    const second=Math.floor(this.clock()/1000);
    if(!this.buckets.has(second)) this.buckets.set(second,{started:0,completed:0,successful:0,errors:0,authFailures:0,missing:0,aborted:0,upstreamErrors:0,bytesIn:0,bytesOut:0,histogram:LIMITS.map(()=>0)});
    return this.buckets.get(second);
  }
  prune() {
    const currentSecond=Math.floor(this.clock()/1000);
    if(this.lastPrunedSecond===currentSecond)return;
    this.lastPrunedSecond=currentSecond;
    const cutoff=Math.floor(this.clock()/1000)-59;
    for(const second of this.buckets.keys()) if(second<cutoff) this.buckets.delete(second);
    for(const [key,item] of this.clients) if(this.clock()-item.lastSeen>=60000) this.clients.delete(key);
  }
  begin({address='unknown',method='GET'}={}) {
    const started=this.clock();
    const client=createHmac('sha256',this.salt).update(address).digest('hex').slice(0,16);
    this.active++; this.total++; this.bucket().started++;
    if(!this.clients.has(client)) {
      if(this.clients.size>=this.maxClients){this.clients.delete(this.clients.keys().next().value);this.evictions++;}
      this.clients.set(client,{lastSeen:started});
    }
    this.clients.get(client).lastSeen=started;
    let ended=false;
    return {client, finish:({status=0,aborted=false,upstreamError=false,bytesIn=0,bytesOut=0}={})=>{
      if(ended)return; ended=true;
      this.active--;this.completed++;
      const b=this.bucket();b.completed++;
      b.successful+=!aborted&&status>=200&&status<400?1:0;
      b.errors+=status>=500?1:0;b.authFailures+=[401,403].includes(status)?1:0;b.missing+=status===404?1:0;
      b.aborted+=aborted?1:0;b.upstreamErrors+=upstreamError?1:0;
      b.bytesIn+=bytesIn;b.bytesOut+=bytesOut;
      b.histogram[LIMITS.findIndex(limit=>this.clock()-started<=limit)]++;
    }};
  }
  snapshot() {
    this.prune();
    this.baseline=this.baseline.filter(sample=>this.clock()-sample.at<=86400000);
    const sum={started:0,completed:0,successful:0,errors:0,authFailures:0,missing:0,aborted:0,upstreamErrors:0,bytesIn:0,bytesOut:0,histogram:LIMITS.map(()=>0)};
    for(const b of this.buckets.values()) for(const key of Object.keys(sum)) {
      if(key==='histogram') b.histogram.forEach((n,i)=>sum.histogram[i]+=n); else sum[key]+=b[key];
    }
    const seconds=Math.min(60,Math.max(1,(this.clock()-this.started)/1000));
    let seen=0,p95=null;
    if(sum.completed) for(let i=0;i<LIMITS.length;i++) {seen+=sum.histogram[i];if(seen>=sum.completed*.95){p95=Number.isFinite(LIMITS[i])?LIMITS[i]:'>30000';break;}}
    const rate=sum.started/seconds;
    const errorRate=sum.errors/Math.max(1,sum.completed);
    const baselineRate=median(this.baseline.map(b=>b.rps));
    const warnings=[];
    if(sum.completed>=20&&errorRate>.1) warnings.push('High server error rate; investigate upstream health, not client intent');
    if(this.baseline.length>=5&&rate>Math.max(10,baselineRate*3)) warnings.push('Traffic exceeds recent baseline; may be legitimate demand');
    if(sum.completed>=20&&(p95==='>30000'||p95>=5000)) warnings.push('Long request lifecycle; slow client or upstream possible');
    // At least 60 elapsed seconds between samples, regardless of dashboard polling.
    if(this.clock()-this.lastBaselineAt>=60000){
      this.lastBaselineAt=this.clock();
      const healthy=sum.completed>=20&&sum.successful/sum.completed>=.95&&
        sum.authFailures===0&&sum.upstreamErrors===0&&sum.aborted===0;
      if(healthy&&!warnings.length){this.baseline.push({at:this.clock(),rps:rate});this.baseline=this.baseline.slice(-60);}
    }
    const pulse={at:new Date(this.clock()).toISOString(),agent:'first-agent-v1',mode:'observe',
      windowSeconds:seconds,totalRequests:this.total,activeRequests:this.active,completedRequests:this.completed,
      requestsPerSecond:Number(rate.toFixed(2)),window:sum,p95LifecycleMsUpperBound:p95,
      recentClientEstimate:this.clients.size,clientEvictions:this.evictions,
      baseline:{samples:this.baseline.length,medianRps:median(this.baseline.map(b=>b.rps)),state:this.baseline.length>=5?'ready':'warming-up'},
      proposal:{type:warnings.length?'anomaly-observed':'no-anomaly',suggestedAction:warnings.length?'investigate':'observe',reasons:warnings},
      warnings,decision:'observe',trainedModel:false};
    pulse.model=evaluatePulse(pulse,this.modelProvider(),'worker',this.clock());
    pulse.trainedModel=pulse.model.trainedModel;
    if(pulse.model.unusual){
      warnings.push('Learned metric deviation; malicious intent is unproven');
      pulse.proposal={type:'anomaly-observed',suggestedAction:'investigate',reasons:warnings};
    }
    return pulse;
  }
}
