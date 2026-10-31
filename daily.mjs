import { fileURLToPath } from 'node:url';
import { DailyLearning } from './daily-learning.mjs';
import { sourceId } from './model-features.mjs';
try{process.loadEnvFile();}catch(error){if(error.code!=='ENOENT')throw error;}
const learning=await new DailyLearning({
  telemetryDirectory:fileURLToPath(new URL('./data/telemetry/',import.meta.url)),
  modelDirectory:fileURLToPath(new URL('./data/models/',import.meta.url)),
  source:sourceId(process.env.TARGET_URL||'http://127.0.0.1:3002')
}).init();
const result=process.argv.includes('--rollback')?{rolledBackTo:await learning.rollback()}:await learning.run({force:process.argv.includes('--force')});
console.log(JSON.stringify(result,null,2));
if(result.status==='error')process.exitCode=1;
