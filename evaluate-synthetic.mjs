import { Guard } from './guard.mjs';
import { writeFileSync } from 'node:fs';
// Offline observations only. Sends no network traffic. Not a real-data benchmark.
const cohorts = [
  ['slow-success',false,200,'/checkout'],
  ['retry-server-error',false,503,'/checkout'],
  ['shared-nat-success',false,200,'/products'],
  ['repeated-missing-link',false,404,'/missing'],
  ['forgotten-password-retry-loop',false,401,'/login'],
  ['synthetic-brute-force',true,401,'/login'],
  ['synthetic-path-scan',true,404,null],
];
const report={source:'synthetic offline fixtures',trainedModel:false,productionAccuracy:null,cohorts:[]};
for(const [name,malicious,status,path] of cohorts){
  let workerFlags=0, supervisorFlags=0;
  for(let session=0;session<500;session++){
    let now=0; const guard=new Guard({clock:()=>now});
    for(let i=0;i<100;i++){
      now+=250+(session%200);
      guard.record('session',{status,path:path || `/missing-${i}`,duration:name==='slow-success'?12000:50});
    }
    workerFlags+=guard.inspect('session').risk==='review'?1:0;
    supervisorFlags+=guard.decision('session').action==='would-rate-limit'?1:0;
  }
  report.cohorts.push({name,malicious,sessions:500,workerFlags,supervisorFlags});
}
report.warning='The forgotten-password cohort intentionally has identical observables to brute force. The supervisor abstains on both: fewer false restrictions, but brute force remains unmitigated pending extra evidence. Repeated deterministic fixtures do not establish statistical confidence. Not a production benchmark.';
writeFileSync('data/synthetic-evaluation.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
