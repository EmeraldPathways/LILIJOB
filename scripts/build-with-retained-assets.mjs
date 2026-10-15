import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const result=spawnSync(process.execPath,['scripts/run-framework.mjs','build'],{stdio:'inherit'});
if(result.status!==0)process.exit(result.status??1);
const retained=path.resolve('compatibility/client-assets/_next/static');
const destination=path.resolve('dist/client/_next/static');
if(existsSync(retained)){
  mkdirSync(destination,{recursive:true});
  cpSync(retained,destination,{recursive:true,force:false,errorOnExist:false});
  console.log('Retained previous-release client assets for already-open pages.');
}
