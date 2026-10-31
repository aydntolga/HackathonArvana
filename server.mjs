import { riskBrief } from './risk-brief.mjs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { LocalReviewer } from './local-reviewer.mjs';
import { createDemoSite } from './demo-site.mjs';
import { FirstAgent } from './first-agent.mjs';
import { createObservedProxy } from './proxy.mjs';
import { startTelemetry } from './telemetry.mjs';
import { restoreBaseline, saveBaseline } from './baseline-store.mjs';
import { DailyLearning } from './daily-learning.mjs';
import { sourceId } from './model-features.mjs';
import { loadAnalytics } from './analytics.mjs';
import { createProductSite } from './product-site.mjs';
import { loadHttpModels,HttpInspector } from './http-models.mjs';

const root = fileURLToPath(new URL('./public/', import.meta.url));
try { process.loadEnvFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const target=process.env.TARGET_URL||'http://127.0.0.1:3002';
const baselineFile=fileURLToPath(new URL('./data/baseline.json',import.meta.url));
const learning=await new DailyLearning({
  telemetryDirectory:fileURLToPath(new URL('./data/telemetry/',import.meta.url)),
  modelDirectory:fileURLToPath(new URL('./data/models/',import.meta.url)),source:sourceId(target)
}).init();
const firstAgent = new FirstAgent({modelProvider:()=>learning.bundle});
const httpInspector=new HttpInspector(await loadHttpModels(fileURLToPath(new URL('./data/http-research/',import.meta.url))));
const baselineCheckpoint=await restoreBaseline(baselineFile,firstAgent,target);
const reviewer = new LocalReviewer({modelProvider:()=>learning.bundle});
reviewer.review(firstAgent.snapshot());
setInterval(()=>reviewer.review(firstAgent.snapshot()),5000).unref();
const telemetry=startTelemetry(firstAgent,fileURLToPath(new URL('./data/telemetry/',import.meta.url)),{
  reviewer,source:sourceId(target),onPersist:()=>saveBaseline(baselineFile,firstAgent,target)
});
learning.start();
const port = Number(process.env.PORT || 3000);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
let analyticsCache=null,analyticsAt=0;
http.createServer(async (req, res) => {
  if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host||'')){res.writeHead(403);return res.end('Local console only');}
  const url = new URL(req.url, 'http://localhost');
  if(url.pathname==='/api/risk-brief'){
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify(riskBrief({...firstAgent.snapshot(),review:reviewer.latest},httpInspector.snapshot())));
  }
  if(url.pathname==='/api/http-inspection'){
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify(httpInspector.snapshot()));
  }
  if(url.pathname==='/api/analytics'){
    try{
      if(!analyticsCache||Date.now()-analyticsAt>10000){analyticsCache=await loadAnalytics(fileURLToPath(new URL('./data/realtime-lab/',import.meta.url)));analyticsAt=Date.now();}
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify(analyticsCache));
    }catch{res.writeHead(500);return res.end(JSON.stringify({error:'Analytics unavailable'}));}
  }
  if(url.pathname==='/api/learning'){
    res.writeHead(200,{'Content-Type':'application/json'});
    return res.end(JSON.stringify({...learning.state,activeVersion:learning.bundle?.version||null,running:learning.busy}));
  }
  if(url.pathname==='/api/pulse') {
    res.writeHead(200,{'Content-Type':'application/json'});
    return res.end(JSON.stringify({...firstAgent.snapshot(),storage:telemetry.state,baselineCheckpoint,review:reviewer.latest}));
  }
  if(url.pathname==='/api/review-history'){
    res.writeHead(200,{'Content-Type':'application/json'});
    return res.end(JSON.stringify({decisions:reviewer.decisions(),note:'State transitions and minute checkpoints; not independent samples.'}));
  }
  if(url.pathname==='/api/hourly-report'){
    try{
      const report=await readFile(new URL('./data/hourly-report.json',import.meta.url),'utf8');
      res.writeHead(200,{'Content-Type':'application/json'});return res.end(report);
    }catch{
      res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({hours:[],status:'Run npm run etl to build the hourly report.'}));
    }
  }
  if (url.pathname === '/api/evaluation') {
    const readJson = async name => { try { return JSON.parse(await readFile(new URL(`./data/${name}`, import.meta.url),'utf8')); } catch { return null; } };
    const [dataset, synthetic] = await Promise.all([readJson('manifest.json'), readJson('synthetic-evaluation.json')]);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({dataset,synthetic}));
  }
  if (url.pathname === '/api/review') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(reviewer.latest));
  }
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, project: 'gtm-hackathon' }));
  }
  const files = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };
  const file = files[url.pathname];
  if (!file) { res.writeHead(404); return res.end('Not found'); }
  try {
    const body = await readFile(path.join(root, file));
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] });
    res.end(body);
  } catch { res.writeHead(500); res.end('Server error'); }
}).listen(port, '127.0.0.1', () => console.log(`GTM development server: http://localhost:${port}`));

if(!process.env.TARGET_URL)createDemoSite().listen(3002,'127.0.0.1');
createObservedProxy({target,agent:firstAgent,httpInspector}).listen(3001,'127.0.0.1',()=>console.log(`First Agent: http://localhost:3001 → ${target} (observe only)`));
telemetry.flush();
createProductSite().listen(Number(process.env.SITE_PORT||3003),'127.0.0.1',()=>console.log(`Product website: http://localhost:${process.env.SITE_PORT||3003} (no telemetry API)`));
