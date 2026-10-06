// Only the intercepted synthetic journey creates traces. Live journeys never do.
import fs from 'node:fs/promises';
import dotenv from 'dotenv';
import JSZip from 'jszip';
dotenv.config({path:'.env.local',quiet:true});
const jwt=/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
function scrub(text){
  if(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)text=text.split(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).join('[redacted-public-key]');
  return text.replace(jwt,'[redacted-token]').replaceAll('test-refresh-token','[redacted-token]').replace(/synthetic-[a-z-]+\.pdf/g,'[synthetic-document]');
}
function clean(value,key=''){
  if(key==='postData')return {mimeType:'[omitted]',text:'Request body omitted from diagnostic trace'};
  if(/^(authorization|apikey|cookie|set-cookie|access_token|refresh_token|token)$/i.test(key))return '[redacted]';
  if(typeof value==='string'){
    if(/^(url|documentURL|referer)$/i.test(key)){
      try{const url=new URL(value);url.search='';url.hash='';return scrub(url.href);}catch{return scrub(value);}
    }
    return scrub(value);
  }
  if(Array.isArray(value))return value.map(v=>clean(v));
  if(value && typeof value==='object'){
    if(typeof value.name==='string'&&/^(authorization|apikey|cookie|set-cookie)$/i.test(value.name))return {...value,value:'[redacted]'};
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clean(v,k)]));
  }
  return value;
}
for(const profile of ['desktop','mobile-throttled']){
  const source=`.next/performance/${profile}-raw-trace.zip`;
  const input=await JSZip.loadAsync(await fs.readFile(source));const output=new JSZip();let redactedEntries=0;
  const omittedResources=new Set();
  for(const [name,entry]of Object.entries(input.files))if(name.endsWith('.network')){
    for(const line of (await entry.async('string')).split('\n')){
      try{const request=JSON.parse(line).snapshot?.request;if(request?.postData?._sha1)omittedResources.add(`resources/${request.postData._sha1}`);}catch{/* Empty line. */}
    }
  }
  for(const [name,entry]of Object.entries(input.files)){
    if(entry.dir||omittedResources.has(name))continue;
    const bytes=await entry.async('nodebuffer');
    // Preserve screenshot/image/font resources. All non-binary resources are
    // synthetic snapshots, deployed public assets or recorded network metadata.
    const binary=bytes.includes(0)||bytes.subarray(0,3).equals(Buffer.from([255,216,255]))||bytes.subarray(0,4).equals(Buffer.from([137,80,78,71]));
    if(binary){output.file(name,bytes);continue;}
    const text=bytes.toString('utf8');
    let safe;
    if(/\.(trace|network|stacks)$/.test(name))safe=text.split('\n').map(line=>{try{return JSON.stringify(clean(JSON.parse(line)));}catch{return scrub(line);}}).join('\n');
    else {try{safe=JSON.stringify(clean(JSON.parse(text)));}catch{safe=scrub(text);}}
    if(safe!==text)redactedEntries++;
    if(jwt.test(safe)||safe.includes('test-refresh-token'))throw Error('Trace privacy check failed.');jwt.lastIndex=0;
    output.file(name,safe);
  }
  await fs.writeFile(`artifacts/performance/${profile}-synthetic-trace.zip`,await output.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
  console.log(JSON.stringify({profile,redactedEntries}));
}
