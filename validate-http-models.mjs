import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {loadHttpModels,forestScore,HttpInspector} from './http-models.mjs';
import {performance} from 'node:perf_hooks';
const root=fileURLToPath(new URL('./data/http-research/',import.meta.url));
const bundle=await loadHttpModels(root);if(!bundle)throw Error('Research model pair did not pass validation');
const rows=JSON.parse(await readFile(new URL('./data/http-research/parity.json',import.meta.url),'utf8'));
let maxDifference=0;const durations=[];
for(let repeat=0;repeat<20;repeat++)for(const row of rows){const began=performance.now();for(const layer of ['worker','reviewer'])maxDifference=Math.max(maxDifference,Math.abs(forestScore(row.x,bundle[layer],row.text||'')-row[layer]));durations.push(performance.now()-began);}
durations.sort((a,b)=>a-b);
const inspector=new HttpInspector(bundle);
const syntheticChecks=[{name:'plain-request',request:{method:'GET',target:'/products'}},{name:'encoded-script',request:{method:'GET',target:'/search?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E'}},{name:'legitimate-query',request:{method:'GET',target:'/search?q=summer+sale'}}].map(({name,request})=>({name,result:inspector.observe(request)}));
const result={at:new Date().toISOString(),modelVersion:bundle.version,parityRows:rows.length,maxDifference,passed:maxDifference<1e-7,p95ModelPairMs:durations[Math.floor(durations.length*.95)],syntheticChecks,scope:'Python/JS prediction parity and local numeric-inference microbenchmark. Not end-to-end proxy overhead or attack-detection accuracy.'};
await writeFile(new URL('./data/http-research/runtime-validation.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;
