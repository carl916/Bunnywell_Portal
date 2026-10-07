import { mkdir, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readDump } from './read-dump.mjs';
import { buildModel } from './model.mjs';
import { collectAssets, saveCorrespondence, sha256 } from './assets.mjs';
import { writeWorkbook, writeWorkingLog } from './workbook.mjs';

export async function generate({dump,media,output,snapshot,projectRef='zxgezoiazsubopqhqhim',runUrl=''}) {
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(snapshot)||!Number.isFinite(Date.parse(snapshot)))throw new Error('Supply the database snapshot timestamp in UTC.');
  await mkdir(output,{recursive:true});
  if((await readdir(output)).length)throw new Error('Use a new empty package directory. Existing packages are immutable.');
  const data=await readDump(dump);
  const model=buildModel(data,{snapshot,projectRef});
  if(model.references.some(r=>r.unresolved))throw new Error('Unresolved file references; package was not published.');
  await collectAssets(model.references,media,output);
  await saveCorrespondence(model.references,output);
  await writeWorkbook(model,path.join(output,'Bunnywell.xlsx'));
  await writeWorkingLog(path.join(output,'Working log.xlsx'),snapshot);
  await writeFile(path.join(output,'README.txt'),[
    'Bunnywell production workbook backup',`Database snapshot: ${snapshot}`,`Backup run: ${runUrl}`,'',
    'Extract the complete ZIP, then open Bunnywell.xlsx. Keep the files folder beside it.',
    'Use the Documents sheet to open retained images, reports, PDFs and saved correspondence.',
    'To continue work, copy Working log.xlsx OUTSIDE the backup folder. Nightly exports do not update your working log or write back to the portal.',
    'Review recorded actions against live data before updating the portal. Authority and approval rules still apply.',
    'All timestamps in the workbook are UTC. Status is as at the snapshot, not live.',
    'External links are listed as exceptions and are not copied. Redacted document versions and temporary upload files are not operational documents.',
    'This is a restricted internal export. It contains buyer and operational contact details.',
    'The database restore archive is retained separately; this workbook does not replace it.','',
  ].join('\n'));
  const files=[];
  async function inventory(folder){for(const entry of await readdir(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isDirectory())await inventory(file);else files.push({path:path.relative(output,file).replaceAll('\\','/'),sha256:await sha256(file)});}}
  await inventory(output);
  const manifest={version:1,projectRef,snapshot,runUrl,createdAt:new Date().toISOString(),sourceDumpSha256:await sha256(dump),counts:model.counts,
    workbook:'Bunnywell.xlsx',files,externalLinks:model.references.filter(r=>r.external).map(r=>({id:r.id,url:r.external})),
    assets:model.references.filter(r=>r.relative).map(({id,parentId,saleId,bucket,key,relative,sha256,bytes})=>({id,parentId,saleId,bucket,key,path:relative,sha256,bytes}))};
  await writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return {manifest,model};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=Object.fromEntries(process.argv.slice(2).map(a=>{const i=a.indexOf('=');if(i<0)throw new Error('Arguments use --name=value');return[a.slice(2,i),a.slice(i+1)];}));
  for(const key of ['dump','media','output','snapshot'])if(!args[key])throw new Error(`Missing --${key}`);
  try{const {manifest}=await generate(args);console.log(JSON.stringify({snapshot:manifest.snapshot,tables:Object.keys(manifest.counts).length,files:manifest.files.length,externalLinks:manifest.externalLinks.length}));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
