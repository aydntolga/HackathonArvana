const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=n=>Number(n||0).toLocaleString('en-US'),pct=v=>v==null?'Not measured':`${(v*100).toFixed(1)}%`;
let data=null,phase='all',selected='all',busy=false;
const svg=(w,h,body,label)=>`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">${body}</svg>`;
const text=(x,y,label,extra='')=>`<text x="${x}" y="${y}" ${extra}>${esc(label)}</text>`;
const customers=()=>data.customers.filter(c=>selected==='all'||c.id===selected);
function traffic(){
  const buckets=new Map();
  for(const c of customers())for(const s of c.samples){if(phase!=='all'&&s.phase!==phase)continue;
    const t=Math.round(Date.parse(s.at)/5000)*5000;
    if(!buckets.has(t))buckets.set(t,{t,values:new Map(),phase:s.phase});buckets.get(t).values.set(c.id,s.rps);
  }
  const rows=[...buckets.values()].sort((a,b)=>a.t-b.t).map(r=>({...r,value:[...r.values.values()].reduce((a,b)=>a+b,0)}));
  if(!rows.length){$('#traffic-chart').innerHTML='<div class="empty">No samples in this selection.</div>';return;}
  const w=1000,h=255,left=42,right=20,top=20,bottom=32,max=Math.max(1,...rows.map(r=>r.value))*1.1;
  const x=i=>left+i*(w-left-right)/Math.max(1,rows.length-1),y=v=>h-bottom-v/max*(h-top-bottom);
  let body='';for(let i=0;i<5;i++){const v=max*i/4;body+=`<line class="gridline" x1="${left}" x2="${w-right}" y1="${y(v)}" y2="${y(v)}"/>`+text(left-8,y(v)+3,v.toFixed(1),'text-anchor="end"');}
  rows.forEach((r,i)=>{if(r.phase==='burst')body+=`<rect x="${Math.max(left,x(i)-10)}" y="${top}" width="20" height="${h-top-bottom}" fill="#fff4db"/>`;});
  const points=rows.map((r,i)=>`${x(i)},${y(r.value)}`).join(' ');
  body+=`<polygon points="${left},${h-bottom} ${points} ${x(rows.length-1)},${h-bottom}" fill="#087f75" fill-opacity=".08"/><polyline points="${points}" fill="none" stroke="#087f75" stroke-width="2.5"/>`;
  rows.forEach((r,i)=>{const label=`${new Date(r.t).toLocaleTimeString('en-GB')} · ${r.phase} · ${r.value.toFixed(2)} requests/s`;
    body+=`<circle tabindex="0" aria-label="${esc(label)}" cx="${x(i)}" cy="${y(r.value)}" r="4" fill="#087f75" stroke="white" stroke-width="2"><title>${esc(label)}</title></circle>`;
    if(i%Math.max(1,Math.floor(rows.length/6))===0)body+=text(x(i),h-8,new Date(r.t).toLocaleTimeString('en-GB'),'text-anchor="middle"');});
  $('#traffic-chart').innerHTML=svg(w,h,body,'Recorded request rate over time');
}
function scatter(){
  const rows=data.customers,w=480,h=260,left=52,bottom=35,max=Math.max(1,...rows.map(c=>c.completed))*1.15;
  const x=n=>left+n/max*(w-left-30),y=n=>h-bottom-Math.log10(Math.max(10,n))/4*(h-bottom-20);
  let body='';for(const value of [10,100,1000,10000])body+=`<line class="gridline" x1="${left}" x2="${w-20}" y1="${y(value)}" y2="${y(value)}"/>`+text(left-8,y(value)+3,`${value} ms`,'text-anchor="end"');
  for(let i=0;i<4;i++){const v=max*i/3;body+=text(x(v),h-12,Math.round(v),'text-anchor="middle"');}
  for(const c of rows){const label=`${c.name}: ${c.completed} requests, p95 ${c.p95RequestMs} ms`;
    const annotation=['slow','overload','campaign','docs'].includes(c.id)||c.id===selected?text(x(c.completed)+10,y(c.p95RequestMs)-8,c.id):'';
    body+=`<g data-customer="${esc(c.id)}" tabindex="0" role="button" aria-label="${esc(label)}" style="cursor:pointer"><circle cx="${x(c.completed)}" cy="${y(c.p95RequestMs)}" r="${c.id===selected?10:7}" fill="${c.reviewerEscalated?'#d45d4c':'#087f75'}" fill-opacity=".8" stroke="white" stroke-width="2"/><title>${esc(label)}</title>${annotation}</g>`;
  }
  $('#scatter-chart').innerHTML=svg(w,h,body,'Request counts versus p95 request duration in milliseconds');
  $('#scatter-chart').querySelectorAll('[data-customer]').forEach(el=>{const choose=()=>{$('#customer').value=el.dataset.customer;selected=el.dataset.customer;render();};el.onclick=choose;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}};});
}
function responses(){
  $('#status-chart').innerHTML=customers().map(c=>`<div class="bar-row"><div class="bar-label"><span>${esc(c.name)}</span><strong>${num(c.completed)}</strong></div><div class="stack">${Object.entries(c.statuses||{}).map(([status,n])=>`<span style="width:${n/Math.max(1,c.completed)*100}%;background:${Number(status)>=500?'#d45d4c':Number(status)>=400?'#c99842':'#087f75'}" title="HTTP ${esc(status)}: ${num(n)}"></span>`).join('')}</div></div>`).join('')+'<div class="legend">Green: success · Amber: 4xx · Coral: 5xx</div>';
}
function decisions(){
  const rows=customers(),all=data.customers.flatMap(c=>c.events||[]),min=Math.min(...all.map(e=>Date.parse(e.at))),max=Math.max(...all.map(e=>Date.parse(e.at)));
  const w=1000,left=205,plot=w-left-20,h=rows.length*59+32;let body='';
  rows.forEach((c,j)=>{body+=text(0,j*59+22,c.name);['worker','reviewer'].forEach((layer,k)=>{
    body+=text(left-10,j*59+16+k*21,layer,'text-anchor="end"');
    (c.events||[]).filter(e=>phase==='all'||e.phase===phase).forEach(e=>{
      const x=left+(Date.parse(e.at)-min)/Math.max(1,max-min)*plot;
      const color=layer==='worker'?(e.workerAnomaly?'#c99842':'#d8e9e0'):(e.verdict==='escalate'?'#d45d4c':['abstain','request-more-evidence'].includes(e.verdict)?'#c99842':'#7eb8a4');
      body+=`<rect x="${x}" y="${j*59+k*21+4}" width="${Math.max(2,plot/120)}" height="15" rx="2" fill="${color}"><title>${esc(`${c.name} / ${new Date(e.at).toLocaleTimeString()} / ${layer==='worker'?(e.workerAnomaly?'anomaly observed':'no anomaly'):e.verdict+' / '+e.diagnosis}`)}</title></rect>`;
    });
  });});
  body+=text(left,h-4,'Start')+text(w-20,h-4,'End of recorded run','text-anchor="end"');
  $('#decision-chart').innerHTML=svg(w,h,body,'Two-agent decision timeline for each customer');
  const c=rows.length===1?rows[0]:null;
  $('#decision-detail').innerHTML=c?`<strong>${esc(c.name)} · ${esc(c.expectedScenario)}</strong>Worker anomaly: ${c.workerFlagged?'observed':'none'} · Reviewer escalation: ${c.reviewerEscalated?'yes':'no'} · Stored replay: ${c.persistedReplayEscalated?'incident confirmed':'no incident escalation'}<br>Detection delay: ${c.detectionDelayMs==null?'not applicable':(c.detectionDelayMs/1000).toFixed(2)+' s'} · Recovered: ${c.recovered?'yes':'no'} · Historical HTTP run: rule-based review`:'Select a customer to inspect its decision outcome. Amber latency flags do not imply an attack; independent review can abstain.';
}
function evaluation(){
  const benchmark=data.measurement;
  if(benchmark){
    $('#model-scores').innerHTML=[['worker','First Agent · robust-distance model'],['reviewer','Upper Agent · contextual model']].map(([key,label])=>{
      const m=benchmark.metrics[key];return `<div class="panel"><span class="eyebrow">LEARNED MODEL / SYNTHETIC HOLDOUT</span><h3>${label}</h3><div class="score">${pct(m.accuracy.value)}<small>accuracy · ${m.accuracy.success}/${m.accuracy.total}</small></div><div class="range"><span style="left:${m.accuracy.interval[0]*100}%;width:${(m.accuracy.interval[1]-m.accuracy.interval[0])*100}%"></span><i style="left:${m.accuracy.value*100}%"></i></div><p class="caption">95% interval ${pct(m.accuracy.interval[0])}–${pct(m.accuracy.interval[1])}; synthetic generator assumptions apply.</p>${[['Precision',pct(m.precision.value)],['Incident recall',pct(m.recall.value)],['Healthy false-alarm rate',pct(m.falseAlarmRate.value)],['Release targets',benchmark.targetChecks?.[key]?.met?'Met in this synthetic test only':'Not yet met']].map(([a,b])=>`<div class="mini-stat"><span>${a}</span><strong>${b}</strong></div>`).join('')}</div>`;}).join('');
    $('#cohort-table').innerHTML=`<table><thead><tr><th>Cohort</th><th>Windows</th><th>Expected incident</th><th>First-model alerts</th><th>Upper-model alerts</th><th>Final escalations</th></tr></thead><tbody>${benchmark.cohorts.map(c=>`<tr><td>${esc(c.cohort)}</td><td>${c.count}</td><td>${c.expectedIncident?'Yes':'No'}</td><td>${c.workerAlerts}</td><td>${c.reviewerAlerts}</td><td>${c.policyEscalations}</td></tr>`).join('')}</tbody></table><p class="caption">Final rule-assisted escalation agreement: ${pct(benchmark.metrics.reviewerPolicy.accuracy.value)}. This is not the learned upper model's standalone accuracy; the synthetic incident definitions overlap with existing health rules.</p>`;
  }else{$('#model-scores').innerHTML='<div class="panel">No completed model benchmark available.</div>';}
  const m=data.metrics,{tp,tn,fp,fn}=m.matrix;
  $('#matrix').innerHTML=`<div class="matrix"><div>Expected overload · escalated<strong>${tp}</strong>Detected scenario</div><div class="bad">Expected normal · escalated<strong>${fp}</strong>False escalation</div><div class="bad">Expected overload · no escalation<strong>${fn}</strong>Missed scenario</div><div>Expected normal · no escalation<strong>${tn}</strong>No incident escalation</div></div>`;
  $('#accuracy-note').textContent=`${m.accuracy.success}/${m.accuracy.total} scenario outcomes agree (${pct(m.accuracy.value)}). ${m.abstainingCustomers} customers included at least one abstention, including warm-up. Unit: a customer scenario, not a request.`;
  $('#intervals').innerHTML=[['Scenario agreement',m.accuracy],['Escalation precision',m.precision],['Overload scenario recall',m.recall],['Healthy scenario false-alarm rate',m.falseAlarmRate]].map(([label,p])=>`<div class="metric-row"><div class="bar-label"><span>${label}</span><strong>${pct(p.value)} <small>(${p.success}/${p.total})</small></strong></div><div class="range">${p.interval?`<span style="left:${p.interval[0]*100}%;width:${(p.interval[1]-p.interval[0])*100}%"></span><i style="left:calc(${p.value*100}% - 2px)"></i>`:''}</div><small>${p.interval?`${pct(p.interval[0])} – ${pct(p.interval[1])}`:'Insufficient denominator'}</small></div>`).join('');
}
function render(){
  if(!data||data.status!=='ready')return;
  const total=data.customers.reduce((n,c)=>n+c.completed,0),etl=data.customers.reduce((n,c)=>n+c.reviewedEtlSamples,0),incident=data.customers.find(c=>c.detectionDelayMs!=null);
  $('#kpis').innerHTML=[['ACTUAL HTTP REQUESTS',num(total),'8 local customer scenarios'],['HTTP FIRST MODEL',pct(data.research?.known?.models.worker.test.accuracy),'CSIC known-app development test'],['HTTP UPPER MODEL',pct(data.research?.known?.models.reviewer.test.accuracy),'CSIC known-app development test'],['INCIDENT DETECTION',incident?(incident.detectionDelayMs/1000).toFixed(2)+' s':'—','First health escalation after burst']].map(([label,value,note])=>`<article class="kpi"><span class="eyebrow">${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('');
  $('#run').textContent=`Run ${data.run.id} · ${new Date(data.run.at).toLocaleString()}`;
  $('#notice').textContent=`RECORDED EXPERIMENT · ${data.run.passed?'Acceptance checks passed':'Acceptance checks failed'} · ${data.provenance}`;
  $('#pipeline-cards').innerHTML=[['01 / CAPTURE',num(total),'Completed real HTTP requests'],['02 / TRANSFER',data.measurement?'2 / 2':'0 / 2',data.measurement?'4,500 synthetic records validated':'Benchmark not run'],['03 / TEST',num(data.measurement?.split.test||0),'Untouched model test windows'],['04 / LEARN',data.measurement?'Pair evaluated':'Not evaluated',data.measurement?'Two fitted test models · weights saved':'No fitted test models']].map(([a,b,c])=>`<div><span class="eyebrow">${a}</span><strong>${b}</strong><p>${c}</p></div>`).join('');
  $('#checks').innerHTML=Object.entries(data.run.checks||{}).map(([k,v])=>`<span class="check ${v?'':'failed'}">${v?'✓':'×'} ${esc(k.replace(/([A-Z])/g,' $1'))}</span>`).join('');
  traffic();scatter();responses();decisions();evaluation();research();
}
async function refresh(){
  if(busy)return;busy=true;
  try{
    const response=await fetch('/api/analytics');if(!response.ok)throw Error('Analytics service unavailable');data=await response.json();
    if(data.status!=='ready'){$('#notice').textContent='No completed experiment found. Run npm run test:realtime to create evidence.';return;}
    const value=selected;$('#customer').innerHTML='<option value="all">All customers</option>'+data.customers.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');$('#customer').value=value;render();
    const results=await Promise.allSettled([fetch('/api/pulse').then(r=>r.json()),fetch('/api/learning').then(r=>r.json())]);
    if(results[0].status==='fulfilled'){const p=results[0].value;$('#live').innerHTML=[['Request rate',`${p.requestsPerSecond} req/s`],['Active requests',p.activeRequests],['Worker',p.proposal.type],['Reviewer',p.review?.verdict||'waiting'],['Action','Observe only']].map(([a,b])=>`<div class="mini-stat"><span>${a}</span><strong>${esc(b)}</strong></div>`).join('');}
    const b=data.measurement;if(b){$('#learning').innerHTML=[['Evaluation status',b.status],['Test model version',b.testModelVersion],['Successful ETL transfers',b.transfers.length],['Training / calibration / test',`${b.split.train} / ${b.split.calibration} / ${b.split.test}`],['Data provenance','Controlled synthetic replay'],['Production schedule','Once daily · separate model registry']].map(([a,v])=>`<div class="mini-stat"><span>${a}</span><strong>${esc(v)}</strong></div>`).join('');}
    $('#updated').textContent=`Refreshed ${new Date().toLocaleTimeString()}`;
  }catch(error){$('#notice').textContent=error.message+' · Previous view may be stale.';}finally{busy=false;}
}
$('#customer').onchange=e=>{selected=e.target.value;render();};
$('#phases').onclick=e=>{if(!e.target.dataset.phase)return;phase=e.target.dataset.phase;$('#phases').querySelectorAll('button').forEach(b=>b.classList.toggle('selected',b.dataset.phase===phase));render();};
$('#refresh').onclick=refresh;
$('#export').onclick=()=>{if(!data)return;const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`server-doctor-evidence-${data.run.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
refresh();setInterval(refresh,15000);

function research(){
  const r=data.research?.known,u=data.research?.unseen;
  if(!r){$('#research-summary').textContent='Research benchmark has not been run.';return;}
  const p2=v=>v==null?'Unavailable':(v*100).toFixed(2)+'%';
  $('#research-summary').innerHTML=`<h3>${num(r.preparation.parsed)} source requests → ${num(r.preparation.unique)} unique requests</h3><p>Train ${num(r.split.train.rows)} · Validate ${num(r.split.validation.rows)} · Test ${num(r.split.test.rows)}. Labels: normal / anomalous HTTP requests.</p><p class="caption">Historical generated research traffic, not production attacks or a DDoS benchmark. Known endpoint families appear across partitions; exact feature duplicates do not cross partitions. Development comparison reuses the evaluation set; external validation remains necessary. <a href="https://www.impactcybertrust.org/dataset_view?idDataset=940" target="_blank" rel="noreferrer">Dataset provenance ↗</a></p>`;
  $('#research-models').innerHTML=['worker','reviewer'].map(key=>{const m=r.models[key].test,b=r.structuralBaseline?.models[key].test;return `<article class="panel"><span class="eyebrow">${key==='worker'?'FIRST AGENT':'UPPER AGENT'} / REQUEST CONTENT</span><div class="score">${p2(m.accuracy)}<small>known-application accuracy</small></div>${[['Anomaly recall',p2(m.recall)],['Precision',p2(m.precision)],['Normal false-alarm rate',p2(m.falseAlarmRate)],['TP / TN / FP / FN',Object.values(m.matrix).join(' / ')]].map(([a,b])=>`<div class="mini-stat"><span>${a}</span><strong>${b}</strong></div>`).join('')}<div class="metric-row"><div class="bar-label"><span>Structural baseline → lexical + structural</span><strong>${p2(b?.accuracy)} → ${p2(m.accuracy)}</strong></div><div class="range"><span style="left:0;width:${m.accuracy*100}%"></span><i style="left:${(b?.accuracy||0)*100}%"></i></div></div><p class="caption">Separate fitted model, validation-selected threshold. Not directly comparable with the older synthetic service-health score.</p></article>`}).join('');
  $('#research-generalization').innerHTML=`<h3>Can it generalize to unseen endpoint templates?</h3>${u?`<p>Strict grouped stress test · ${num(u.split.test.rows)} requests.</p><div class="table-wrap"><table><thead><tr><th>Model</th><th>Accuracy</th><th>Anomaly recall</th><th>False-alarm rate</th></tr></thead><tbody>${['worker','reviewer'].map(k=>{const m=u.models[k].test;return `<tr><td>${k}</td><td>${p2(m.accuracy)}</td><td>${p2(m.recall)}</td><td>${p2(m.falseAlarmRate)}</td></tr>`}).join('')}</tbody></table></div>`:'<p>Stress report unavailable.</p>'}<p class="caption">Separately trained endpoint-grouped evaluation. Conservative validation thresholds miss many anomalies on new templates. Neither model meets a general deployment claim. Target: ≥95% recall and ≤1% normal false alarms on independent, representative labeled data.</p>`;
  fetch('/api/http-inspection').then(r=>r.json()).then(v=>{$('#http-live').innerHTML=`<h3>Local request inspection · ${v.enabled?'loaded':'unavailable'}</h3><p>Model ${esc(v.version||'none')} · Observation only. Bounded payload prefixes are processed transiently; raw requests are not stored by this inspector.</p><p class="caption">Python / JavaScript parity: ${data.research.runtime?.passed?'verified on 50 requests':'not verified'}. A separate legitimate-query smoke check triggered both models: false alarms remain possible outside this dataset.</p>`}).catch(()=>{$('#http-live').textContent='Live inspection status unavailable.'});
}

async function refreshRisk(){try{const response=await fetch('/api/risk-brief');if(!response.ok)throw Error();const r=await response.json();$('#risk-brief').innerHTML=`<span class="badge">${esc(r.level.toUpperCase())}</span><h3>${esc(r.headline)}</h3><p>${r.reasons.map(esc).join(' ')}</p><h4>Recommended next step</h4><ul>${r.nextSteps.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><p class="caption">${esc(r.scope)} Vulnerabilities: not assessed. Output: information, not an automatic alarm or block.</p>`;}catch{$('#risk-brief').textContent='Risk advisory unavailable. No safe-state conclusion can be made.';}}
refreshRisk();setInterval(refreshRisk,5000);
