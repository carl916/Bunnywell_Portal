import fs from 'node:fs';
const local='http://127.0.0.1:3037',hosted='https://bunnywell-portal-integration-carl-gilbert-s-projects.vercel.app';
export const reviewOrigin=process.env.HOSTED_REVIEW_URL||local;
if(![local,hosted].includes(reviewOrigin))throw Error('Unknown review app');
function access(){if(reviewOrigin===local)return null;const a=JSON.parse(fs.readFileSync('tmp/hosted-integration/verification-access.json','utf8'));if(a.origin!==hosted||!a.secret)throw Error('Scoped temporary verification access missing');return a;}
export const reviewFetch=(input,options={})=>{const u=new URL(input);if(u.origin!==reviewOrigin)throw Error('Wrong app origin');const a=access();return fetch(input,{...options,redirect:'error',headers:{...options.headers,...(a?{'x-vercel-protection-bypass':a.secret}:{})}});};
export async function protectContext(context){const a=access();if(!a)return;await context.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin===a.origin)await route.continue({headers:{...route.request().headers(),'x-vercel-protection-bypass':a.secret}});else await route.continue();});}
export const evidenceName=name=>reviewOrigin===local?name:name.replace(/\.json$/, '-hosted.json');

export function protectedRequestHeaders(request){const a=access();return {...request.headers(),...(a&&new URL(request.url()).origin===a.origin?{'x-vercel-protection-bypass':a.secret}:{})};}
