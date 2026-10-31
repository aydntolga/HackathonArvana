const status = document.querySelector('#status');
async function refresh() {
  try {
    const response = await fetch('/api/pulse');
    if (!response.ok) throw new Error('Service unavailable');
    const {review,...pulse} = await response.json();
    status.textContent = `Mode: ${pulse.mode} | Live blocking disabled | Requests: ${pulse.totalRequests}`;
    document.querySelector('#traffic').textContent=JSON.stringify(pulse,null,2);
    document.querySelector('#review').textContent=JSON.stringify(review || {state:'warming-up'},null,2);
  } catch { status.textContent='Observation service disconnected'; }
}
refresh(); setInterval(refresh,2000);
async function showEvaluation(){
  try {
    const {dataset,synthetic}=await (await fetch('/api/evaluation')).json();
    const lines=[dataset ? `Official source: ${dataset.file}\nSource label counts: ${JSON.stringify(dataset.labels)}\nSource metadata only: download the CSV with download_dataset.py. No model trained.` : 'Dataset manifest unavailable.',
      'Synthetic fixtures are engineering checks, not real-world accuracy:',
      ...(synthetic?.cohorts||[]).map(c=>`${c.name}: ${c.sessions} sessions | worker flags ${c.workerFlags}, reviewed restrictions ${c.supervisorFlags}`),
      'Abstention protects ambiguous users but can also leave attacks unmitigated.'];
    document.querySelector('#evaluation').textContent=lines.join('\n\n');
  }catch{document.querySelector('#evaluation').textContent='Evaluation metadata unavailable';}
}
showEvaluation();setInterval(showEvaluation,10000);
async function showHistory(){
  try{
    const [history,report]=await Promise.all([
      fetch('/api/review-history').then(r=>r.json()),fetch('/api/hourly-report').then(r=>r.json())
    ]);
    const cards=history.decisions.slice(-8).reverse().map(decision=>{
      const card=document.createElement('article');card.className='decision';
      const title=document.createElement('strong');title.textContent=`${decision.verdict} / ${decision.diagnosis}`;
      const timestamp=document.createElement('small');timestamp.textContent=`${new Date(decision.at).toLocaleTimeString()} / ${decision.relationship}`;
      const explanation=document.createElement('p');explanation.textContent=decision.reasons.join(' ');
      card.append(title,timestamp,explanation);return card;
    });
    document.querySelector('#timeline').replaceChildren(...cards);
    document.querySelector('#etl').textContent=JSON.stringify({...report,hours:report.hours.slice(-6)},null,2);
  }catch{document.querySelector('#timeline').textContent='Decision history temporarily unavailable';}
}
showHistory();setInterval(showHistory,5000);
