// Evidence-based advisory, not a vulnerability scanner or attack forecast.
export function riskBrief(pulse,inspection,now=Date.now()){
 const recent=(inspection?.recent||[]).filter(x=>Number.isFinite(Date.parse(x.at))&&now-Date.parse(x.at)>=0&&now-Date.parse(x.at)<=60000);
 const reviewed=recent.filter(x=>x.reviewerFlag), disagreements=recent.filter(x=>x.workerFlag!==x.reviewerFlag);
 const fresh=Number.isFinite(Date.parse(pulse?.at))&&now-Date.parse(pulse.at)>=0&&now-Date.parse(pulse.at)<=15000;
 const observed=fresh&&(pulse?.window?.completed||0)>0;
 const stressed=observed&&pulse?.review?.verdict==='escalate';
 const level=stressed?'high':reviewed.length?'elevated':disagreements.length?'review-needed':observed?'no-current-signal':'insufficient-evidence';
 const reasons=[];
 if(stressed)reasons.push('The service-health reviewer reports current degradation. Malicious intent is not established.');
 if(reviewed.length)reasons.push(`${reviewed.length} retained recent request patterns were flagged by the independent request reviewer.`);
 if(disagreements.length)reasons.push('The request models disagree on recent evidence. Investigate before taking action.');
 if(!reasons.length)reasons.push(observed?'No corroborated risk signal in the available current window. This does not establish security.':'Current completed traffic evidence is missing or stale.');
 return {at:new Date(now).toISOString(),level,headline:stressed?'Service resilience may be under pressure':reviewed.length?'Suspicious request patterns need investigation':disagreements.length?'Conflicting evidence needs review':observed?'No current corroborated warning':'More current evidence is required',reasons,
 nextSteps:stressed?['Inspect capacity, upstream errors and recent deployments.','Compare request patterns with authorized campaign traffic.']:reviewed.length||disagreements.length?['Review flagged request patterns against application context.','Check endpoint validation and authorized security-test results.']:['Continue observation and collect representative labeled traffic.'],
 vulnerabilityStatus:'not-assessed',attackLikelihood:null,forecastHorizon:null,action:'inform-only',
 scope:'Traffic-derived early risk advisory. Not a vulnerability assessment, proof of attack, or validated prediction of a future attack. Recent request evidence is capped at 20 retained flags.'};
}
