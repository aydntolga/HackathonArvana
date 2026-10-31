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
