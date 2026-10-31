import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {HTTP_FEATURES,extractHttpFeatures,decodeHttpText,httpModelText} from './http-features.mjs';
const root=fileURLToPath(new URL('./data/http-research/',import.meta.url));await mkdir(root,{recursive:true});
const hash=x=>createHash('sha256').update(x).digest('hex');
const rows=[],seen=new Map();let parsed=0,duplicates=0,conflicts=0,malformed=0;
const sources=[];
for(const [filename,label] of [['normalTrafficTraining.txt',0],['normalTrafficTest.txt',0],['anomalousTrafficTest.txt',1]]){
  const raw=await readFile(path.join(root,filename),'latin1');
  const requests=raw.split(/(?=^(?:GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH)\s+\S+\s+HTTP\/1\.[01]\s*$)/m).filter(s=>/^(?:GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH) /.test(s));
  sources.push({filename,parsed:requests.length,label});
  for(const request of requests){
    parsed++;const normalized=request.replace(/\r\n/g,'\n'),first=normalized.split('\n')[0].match(/^(\S+)\s+(\S+)\s+HTTP\/1\.[01]/);
    if(!first){malformed++;continue;}
    const method=first[1],target=first[2].replace(/^https?:\/\/[^/]+/i,'');
    const split=normalized.indexOf('\n\n');let body=split>=0?normalized.slice(split+2).trim():'';
    if(method==='GET'||method==='HEAD')body='';
    const x=extractHttpFeatures({method,target,body});
    // Group all requests to the same endpoint/parameter shape, not random rows.
    const pathname=decodeHttpText(target.split('?')[0]).replace(/\d+/g,'#').toLowerCase();
    const parameterKeys=(s)=>s.split('&').filter(Boolean).map(p=>decodeHttpText(p.split('=')[0])).sort();
    const template=method+'|'+pathname+'|'+parameterKeys(target.split('?').slice(1).join('?')).join(',')+'|'+parameterKeys(body).join(',');
    const id=hash(method+'\n'+decodeHttpText(target)+'\n'+decodeHttpText(body));
    if(seen.has(id)){if(seen.get(id).label!==label){seen.get(id).conflict=true;conflicts++;}else duplicates++;continue;}
    const row={id,group:hash(template),label,x,text:httpModelText({method,target,body})};seen.set(id,row);rows.push(row);
  }
}
const valid=rows.filter(r=>!r.conflict);
await writeFile(path.join(root,'features.jsonl'),valid.map(JSON.stringify).join('\n')+'\n');
const report={features:HTTP_FEATURES,parsed,unique:valid.length,duplicates,conflicts,malformed,groups:new Set(valid.map(r=>r.group)).size,sources,labels:{normal:valid.filter(r=>!r.label).length,anomalous:valid.filter(r=>r.label).length},splitPolicy:'Endpoint template metadata is available; actual partition protocol is recorded in the training report. Normalized exact-request deduplication and conflicting-label exclusion; no header, host, cookie, label, timestamp or file-origin features.'};
await writeFile(path.join(root,'preparation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
