import http from 'node:http';
import {readFile} from 'node:fs/promises';
export function createProductSite(){
  return http.createServer(async(req,res)=>{
    const routes={'/':['index.html','text/html; charset=utf-8'],'/site.css':['site.css','text/css; charset=utf-8']};
    const route=routes[new URL(req.url,'http://localhost').pathname];
    if(!['GET','HEAD'].includes(req.method)||!route){res.writeHead(404);return res.end('Not found');}
    try{const body=await readFile(new URL(`./website/${route[0]}`,import.meta.url));res.writeHead(200,{'Content-Type':route[1],'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'"});res.end(req.method==='HEAD'?undefined:body);}
    catch{res.writeHead(500);res.end('Website unavailable');}
  });
}
