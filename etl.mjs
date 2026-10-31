import {fileURLToPath} from 'node:url';
import {runEtl} from './etl-core.mjs';
const result=await runEtl(fileURLToPath(new URL('./data/telemetry/',import.meta.url)),fileURLToPath(new URL('./data/hourly-report.json',import.meta.url)));
console.log(`Wrote ${result.hours.length} hourly summaries; ${result.invalidLines} invalid lines`);
