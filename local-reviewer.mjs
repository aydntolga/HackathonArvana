// Evidence-based local reviewer. No LLM, trained classifier, or calibrated probability.
export class LocalReviewer {
  constructor({clock=Date.now}={}){this.clock=clock;this.history=[];this.timeline=[];this.latest=null;}
  record(audit){
    const signature=JSON.stringify([audit.verdict,audit.diagnosis,audit.relationship]);
    const previous=this.timeline.at(-1);
    if(!previous||previous.signature!==signature||this.clock()-Date.parse(previous.at)>=60000){
      this.timeline.push({...structuredClone(audit),signature});this.timeline=this.timeline.slice(-60);
    }
    this.latest=audit;return audit;
  }
  decisions(){return this.timeline.map(({signature,...decision})=>structuredClone(decision));}
  review(pulse){
    const now=this.clock(),w=pulse?.window;
    const audit={at:new Date(now).toISOString(),sourceAt:pulse?.at||null,engine:'local-reviewer-v1',trainedModel:false,
      verdict:'observe',action:'observe',confidence:null,diagnosis:'insufficient-data',
      reasons:[],counterHypotheses:[],workerProposal:pulse?.proposal?{
        type:String(pulse.proposal.type||'unknown').slice(0,80),
        suggestedAction:String(pulse.proposal.suggestedAction||'unknown').slice(0,80)
      }:null,evidence:{},relationship:'consistent'};
    const keys=['started','completed','successful','errors','authFailures','missing','aborted','upstreamErrors'];
    const invalid=!w||keys.some(k=>!Number.isSafeInteger(w[k])||w[k]<0)||
      !Number.isFinite(pulse.requestsPerSecond)||pulse.requestsPerSecond<0||
      !Number.isFinite(Date.parse(pulse.at))||Math.abs(now-Date.parse(pulse.at))>15000||
      Date.parse(pulse.at)>now+1000||!Number.isSafeInteger(pulse.activeRequests)||pulse.activeRequests<0||
      !Number.isFinite(pulse.windowSeconds)||pulse.windowSeconds<=0||pulse.windowSeconds>60||
      Math.abs(pulse.requestsPerSecond-w.started/pulse.windowSeconds)>.015||
      w.successful+w.errors+w.authFailures+w.missing>w.completed||w.aborted>w.completed||w.upstreamErrors>w.completed||
      !Array.isArray(w.histogram)||w.histogram.some(n=>!Number.isSafeInteger(n)||n<0)||w.histogram.reduce((a,b)=>a+b,0)!==w.completed||
      !(pulse.p95LifecycleMsUpperBound===null&&w.completed===0||pulse.p95LifecycleMsUpperBound==='>30000'||Number.isFinite(pulse.p95LifecycleMsUpperBound)&&pulse.p95LifecycleMsUpperBound>=0)||
      !pulse.baseline||!Number.isSafeInteger(pulse.baseline.samples)||pulse.baseline.samples<0||pulse.baseline.samples>60||
      !Number.isFinite(pulse.baseline.medianRps)||pulse.baseline.medianRps<0||
      !['ready','warming-up'].includes(pulse.baseline.state)||
      (pulse.baseline.state==='ready')!==(pulse.baseline.samples>=5);
    if(invalid){audit.verdict='abstain';audit.relationship='insufficient-evidence';audit.reasons.push('Missing, stale, or inconsistent measurements; abstaining from intervention.');return this.record(audit);}
    const n=w.completed,errorRate=w.errors/Math.max(1,n),authRate=w.authFailures/Math.max(1,n);
    const successRate=(w.successful||0)/Math.max(1,n);
    const slow=pulse.p95LifecycleMsUpperBound==='>30000'||Number(pulse.p95LifecycleMsUpperBound)>=5000;
    const baselineReady=pulse.baseline?.state==='ready'&&pulse.baseline.samples>=5;
    const surge=baselineReady&&pulse.requestsPerSecond>Math.max(10,pulse.baseline.medianRps*3);
    audit.evidence={completed:n,errorRate,authRate,successRate,slow,surge,baselineReady,active:pulse.activeRequests};
    // History holds bounded observations; overlapping windows are NOT independent samples.
    this.history=this.history.filter(p=>now-p.time<180000);
    if(!this.history.length||now-this.history.at(-1).time>=5000)this.history.push({time:now,errorRate,slow,surge});
    this.history=this.history.slice(-36);
    if(n<20){audit.verdict='abstain';audit.reasons.push('Waiting for at least 20 completed requests before assessing this window.');}
    else if(errorRate>.1||w.upstreamErrors>=3){
      audit.diagnosis='service-health-incident';audit.verdict='escalate';
      audit.reasons.push('Server or upstream failures do not justify blocking the client.');
      audit.counterHypotheses.push('Application failure','Upstream connectivity failure','Legitimate retries after failures');
    } else if(authRate>.5){
      audit.diagnosis='ambiguous-authentication';audit.verdict='abstain';
      audit.reasons.push('Account and session evidence is missing; password retries cannot be distinguished from brute force.');
      audit.counterHypotheses.push('Forgotten password','Expired session','Automated client retry loop');
    } else if(slow){
      audit.diagnosis='latency-with-uncertain-cause';audit.verdict='abstain';
      audit.reasons.push('Long request lifecycle alone cannot distinguish network delay from application delay or an attack.');
      audit.counterHypotheses.push('Slow client','Slow upstream','Large file transfer');
    } else if(surge){
      audit.diagnosis=successRate>=.9?'possible-legitimate-demand':'unexplained-traffic-surge';
      audit.verdict='request-more-evidence';audit.reasons.push('Traffic increased; volume alone is not evidence of malicious intent.');
      audit.counterHypotheses.push('Campaign or legitimate demand','Shared NAT','Bot traffic');
    } else {
      audit.diagnosis=baselineReady?'normal-observed-window':'baseline-warming-up';
      audit.reasons.push('No evidence in this window supports automatic restriction.');
    }
    if(pulse.proposal?.suggestedAction==='rate-limit'){
      audit.workerRestrictionVetoed=true;
      audit.relationship='worker-restriction-vetoed';
      audit.reasons.push('Worker restriction vetoed: identity and causal evidence are insufficient.');
    } else if(['service-health-incident','ambiguous-authentication','latency-with-uncertain-cause','unexplained-traffic-surge'].includes(audit.diagnosis)&&pulse.proposal?.type==='no-anomaly'){
      audit.relationship='worker-missed-evidence';
      audit.reasons.push('The worker reported no anomaly, but the independent evidence check found a condition to investigate.');
    }
    audit.history={observations:this.history.length,spanSeconds:this.history.length?(now-this.history[0].time)/1000:0};
    audit.nextStep=audit.verdict==='escalate'?'Inspect upstream health metrics':'Continue collecting observations';
    return this.record(audit);
  }
}
