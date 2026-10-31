import http from 'node:http';
const page=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Demo Customer — Server Doctor</title><style>body{font:18px system-ui;max-width:760px;margin:70px auto;padding:24px;background:#101723;color:#e9edf5}button{font:inherit;padding:14px;margin:6px;cursor:pointer}pre{white-space:pre-wrap}small{color:#bdc8dd}</style><h1>Demo customer store</h1><p>Local presentation website. Access it through port 3001 to observe its traffic with First Agent.</p><button data-route="/products">Load products</button><button data-route="/slow">Slow response</button><button data-route="/failure">Server failure</button><button data-route="/login">Failed login example</button><pre id="result">Choose an action.</pre><small>Local demo only. No real customer data or payments.</small><script>document.querySelectorAll('button').forEach(b=>b.onclick=async()=>{const start=performance.now();const response=await fetch(b.dataset.route);document.querySelector('#result').textContent='HTTP '+response.status+' · '+Math.round(performance.now()-start)+' ms\\n'+await response.text();});</script></html>`;
export function createDemoSite(){return http.createServer((req,res)=>{
  req.resume();req.on('end',()=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(page);}
    const respond=()=>{const status=pathname==='/failure'?503:pathname==='/login'?401:['/products','/slow','/checkout'].includes(pathname)?200:404;
      res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({demo:true,path:pathname,status,products:pathname==='/products'?['Demo product A','Demo product B']:undefined}));};
    if(pathname==='/slow')setTimeout(respond,1000);else respond();
  });
});}
