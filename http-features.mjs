// Shared offline/online extractor. Never returns raw payload, identity, headers or parameter values.
export const HTTP_FEATURES=['logTargetLength','logBodyLength','logDecodedLength','methodPost','methodOther','pathDepth','parameterCount','maxValueLength','meanValueLength','digitRatio','alphaRatio','spaceRatio','specialRatio','percentCount','angleCount','quoteCount','semicolonCount','slashCount','dotCount','equalsCount','sqlTokens','scriptTokens','traversalTokens','controlCount','nonAsciiCount','entropy','longestRun','riskyExtension','fileReferenceTokens','doubleEncoding'];
export const HTTP_CAPTURE_LIMIT=16384;
export function decodeHttpText(text){let value=String(text);for(let i=0;i<2;i++)value=value.replace(/%([0-9a-f]{2})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16))).replace(/\+/g,' ');return value;}
export function httpModelText({method='GET',target='/',body=''}={}){
  target=String(target).replace(/^https?:\/\/[^/]+/i,'').slice(0,HTTP_CAPTURE_LIMIT);body=String(body).slice(0,HTTP_CAPTURE_LIMIT);
  return (String(method)+' '+decodeHttpText(target)+' '+decodeHttpText(body)).toLowerCase().replace(/\s+/g,' ');
}
export function extractHttpFeatures({method='GET',target='/',body=''}={}){
  target=String(target).replace(/^https?:\/\/[^/]+/i,'').slice(0,HTTP_CAPTURE_LIMIT);
  body=String(body).slice(0,HTTP_CAPTURE_LIMIT);
  const raw=target+' '+body,decoded=decodeHttpText(raw).toLowerCase(),n=Math.max(1,decoded.length);
  const pathname=decodeHttpText(target.split('?')[0]).toLowerCase();
  const values=(target.includes('?')?target.slice(target.indexOf('?')+1)+'&':'')+body;
  const parts=values.split('&').filter(Boolean),lens=parts.map(p=>decodeHttpText(p.includes('=')?p.slice(p.indexOf('=')+1):p).length);
  const count=re=>(decoded.match(re)||[]).length;
  const frequencies=new Map();for(const char of decoded)frequencies.set(char,(frequencies.get(char)||0)+1);
  const entropy=-[...frequencies.values()].reduce((sum,k)=>sum+(k/n)*Math.log2(k/n),0);
  let longest=0,run=0,previous=null;for(const char of decoded){run=char===previous?run+1:1;longest=Math.max(longest,run);previous=char;}
  return [Math.log1p(target.length),Math.log1p(body.length),Math.log1p(decoded.length),method==='POST'?1:0,!['GET','POST','HEAD'].includes(method)?1:0,
    pathname.split('/').filter(Boolean).length,parts.length,Math.log1p(Math.max(0,...lens)),Math.log1p(lens.reduce((a,b)=>a+b,0)/Math.max(1,lens.length)),
    count(/[0-9]/g)/n,count(/[a-z]/g)/n,count(/\s/g)/n,count(/[^a-z0-9\s]/g)/n,(raw.match(/%[0-9a-f]{2}/gi)||[]).length,
    count(/[<>]/g),count(/["'`]/g),count(/;/g),count(/[\/\\]/g),count(/\./g),count(/=/g),
    count(/\b(select|union|insert|update|delete|drop|exec|sleep|benchmark|or|and)\b/g),
    count(/<script|javascript:|onerror\s*=|onload\s*=|<iframe|alert\s*\(/g),count(/\.\.[\/\\]/g),count(/[\x00-\x1f\x7f]/g),count(/[^\x00-\x7f]/g),entropy,Math.log1p(longest),
    /\.(bak|old|conf|ini|sql|log|htaccess|git)(?:$|[;\/])/.test(pathname)?1:0,count(/\/etc\/|win\.ini|passwd|cmd\.exe|\/bin\/|\.htaccess/g),(raw.match(/%25[0-9a-f]{2}/gi)||[]).length];
}
