import http from 'node:http';
import https from 'node:https';
import {HTTP_CAPTURE_LIMIT} from './http-features.mjs';

function cleanHeaders(headers) {
  const result={...headers};
  const named=String(result.connection||'').split(',').map(s=>s.trim().toLowerCase());
  for(const key of [...named,'connection','proxy-connection','keep-alive','transfer-encoding','te','trailer','upgrade','proxy-authorization','proxy-authenticate']) delete result[key];
  // Never trust client-supplied forwarding identity in this local prototype.
  for(const key of ['forwarded','x-forwarded-for','x-forwarded-host','x-forwarded-proto'])delete result[key];
  return result;
}
export function createObservedProxy({target,agent,httpInspector=null}) {
  const upstream=new URL(target);
  if(!['http:','https:'].includes(upstream.protocol)||upstream.username||upstream.password)throw new Error('Invalid TARGET_URL');
  const transport=upstream.protocol==='https:'?https:http;
  const server=http.createServer((req,res)=>{
    const observation=agent.begin({address:req.socket.remoteAddress,method:req.method});
    let bytesIn=0,bytesOut=0,upstreamError=false,inspected=false,captured=0;const chunks=[];
    const finish=aborted=>{
      observation.finish({status:res.statusCode,aborted,upstreamError,bytesIn,bytesOut});
      if(httpInspector&&!inspected){inspected=true;
        httpInspector.observe({method:req.method,target:req.url,body:Buffer.concat(chunks).toString('latin1')},{truncated:bytesIn>HTTP_CAPTURE_LIMIT||req.url.length>HTTP_CAPTURE_LIMIT,partial:!req.complete});
        chunks.length=0;
      }
    };
    res.once('finish',()=>finish(false));res.once('close',()=>finish(!res.writableFinished));
    // Only origin-form paths are accepted. Target host always comes from operator configuration.
    if(!req.url.startsWith('/')||req.url.startsWith('//')){res.writeHead(400);res.end('Invalid request target');return;}
    const headers=cleanHeaders(req.headers);headers.host=upstream.host;
    const out=transport.request({protocol:upstream.protocol,hostname:upstream.hostname,port:upstream.port,
      method:req.method,path:req.url,headers},incoming=>{
      res.writeHead(incoming.statusCode,cleanHeaders(incoming.headers));
      incoming.on('data',chunk=>{bytesOut+=chunk.length;});
      incoming.on('error',()=>{upstreamError=true;res.destroy();});
      incoming.pipe(res);
    });
    out.on('error',()=>{upstreamError=true;if(!res.headersSent){res.writeHead(502);res.end('Upstream unavailable');}else res.destroy();});
    out.setTimeout(120000,()=>out.destroy(new Error('Upstream idle timeout')));
    req.on('data',chunk=>{bytesIn+=chunk.length;if(httpInspector&&captured<HTTP_CAPTURE_LIMIT){const copy=Buffer.from(chunk.subarray(0,HTTP_CAPTURE_LIMIT-captured));chunks.push(copy);captured+=copy.length;}});
    req.once('aborted',()=>out.destroy());
    req.on('error',()=>out.destroy());
    res.once('close',()=>{if(!res.writableFinished)out.destroy();});
    req.pipe(out); // Native backpressure; no request-body buffering, storage or model calls.
  });
  server.headersTimeout=60000;server.requestTimeout=120000;
  // WebSockets and CONNECT require a separate tunnel collector; reject explicitly for now.
  server.on('upgrade',(req,socket)=>{const event=agent.begin({address:socket.remoteAddress});socket.end('HTTP/1.1 501 Not Implemented\r\nConnection: close\r\n\r\n');event.finish({status:501});});
  server.on('connect',(req,socket)=>{const event=agent.begin({address:socket.remoteAddress});socket.end('HTTP/1.1 501 Not Implemented\r\nConnection: close\r\n\r\n');event.finish({status:501});});
  return server;
}
