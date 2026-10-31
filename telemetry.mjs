import {mkdir,appendFile,readdir,unlink} from 'node:fs/promises';
import path from 'node:path';

export function startTelemetry(agent,directory,{intervalMs=60000,retentionDays=7}={}) {
  let busy=false;const state={lastWrite:null,lastError:null,skippedWrites:0};
  async function flush(){
    if(busy){state.skippedWrites++;return;}busy=true;
    try {
      const snapshot=agent.snapshot();
      await mkdir(directory,{recursive:true});
      const day=snapshot.at.slice(0,10);
      await appendFile(path.join(directory,`${day}.jsonl`),JSON.stringify(snapshot)+'\n');
      for(const name of await readdir(directory)) if(/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)&&Date.now()-Date.parse(name.slice(0,10))>retentionDays*86400000)await unlink(path.join(directory,name));
      state.lastWrite=snapshot.at;state.lastError=null;
    }catch(error){state.lastError=error.message;}finally{busy=false;}
  }
  const timer=setInterval(flush,intervalMs);timer.unref();
  return {state,flush,stop:()=>clearInterval(timer)};
}
