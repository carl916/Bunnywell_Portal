import fs from 'node:fs';
import { createHash } from 'node:crypto';
const out='artifacts/performance/2026-10-05-targeted-region';
const deployments=JSON.parse(fs.readFileSync(`${out}/deployments.json`));
const assetPath='/_next/static/chunks/turbopack-2_9az3epal9fr.js';
const hash=v=>createHash('sha256').update(v).digest('hex');
const rows=await Promise.all(['iad1','fra1'].map(async region=>{
 const d=deployments[region],r=await fetch(d.origin+assetPath);
 if(!r.ok)throw Error(`Runtime fetch rejected ${r.status}`);
 const body=await r.text(),occurrences=body.split(d.deploymentId).length-1;
 const normalised=body.replaceAll(d.deploymentId,'DEPLOYMENT_ID');
 return {region,status:r.status,assetPath,bytes:Buffer.byteLength(body),sha256:hash(body),cache:r.headers.get('x-vercel-cache'),vercelId:r.headers.get('x-vercel-id'),deploymentIdOccurrences:occurrences,normalisedSha256:hash(normalised)};
}));
const result={verifiedAt:new Date().toISOString(),rows,onlyDeploymentIdDiffers:rows.every(r=>r.deploymentIdOccurrences>0)&&rows[0].normalisedSha256===rows[1].normalisedSha256};
fs.writeFileSync(`${out}/runtime-asset-verification.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
