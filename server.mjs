import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { LocalReviewer } from './local-reviewer.mjs';
import { createDemoSite } from './demo-site.mjs';
import { FirstAgent } from './first-agent.mjs';
import { createObservedProxy } from './proxy.mjs';
import { startTelemetry } from './telemetry.mjs';

const root = fileURLToPath(new URL('./public/', import.meta.url));
try { process.loadEnvFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const firstAgent = new FirstAgent();
const reviewer = new LocalReviewer();
reviewer.review(firstAgent.snapshot());
setInterval(()=>reviewer.review(firstAgent.snapshot()),5000).unref();
const telemetry=startTelemetry(firstAgent,fileURLToPath(new URL('./data/telemetry/',import.meta.url)));
const port = Number(process.env.PORT || 3000);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if(url.pathname==='/api/pulse') {
    res.writeHead(200,{'Content-Type':'application/json'});
    return res.end(JSON.stringify({...firstAgent.snapshot(),storage:telemetry.state,review:reviewer.latest}));
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

const target=process.env.TARGET_URL||'http://127.0.0.1:3002';
if(!process.env.TARGET_URL)createDemoSite().listen(3002,'127.0.0.1');
createObservedProxy({target,agent:firstAgent}).listen(3001,'127.0.0.1',()=>console.log(`First Agent: http://localhost:3001 → ${target} (observe only)`));
telemetry.flush();
