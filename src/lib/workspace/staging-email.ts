// The only sales-email provider boundary used by staging. Keep this module pure
// apart from the explicit, injectable HTTP call so the final payload is testable.
export const stagingDeliveryAddress='carl@accoladeproperties.co.uk';
export type IntendedPerson={email:string;name?:string|null;role?:string|null}|string;
export type IntendedRecipients={to:IntendedPerson[];cc:IntendedPerson[];bcc:IntendedPerson[]};
export type OriginalMail={subject:string;text:string;html:string;from?:string;attachments?:unknown[]};
export type ProviderPayload=OriginalMail&{from:string;to:string[];cc:string[];bcc:string[];reply_to:string};
export function isStagingSalesRequest(url:string,env:Record<string,string|undefined>){
 return new URL(url).hostname==='staging.bunnywell.co.uk'||env.VERCEL_ENV==='preview'||
  env.NEXT_PUBLIC_SUPABASE_URL==='https://vxkpvdtrldwwqiddoyof.supabase.co'||env.NEXT_PUBLIC_WORKSPACE_STAGING==='1';
}
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function person(value:IntendedPerson){
 if(typeof value==='string')return value;
 const role=({admin:'Developer',developer:'Developer',sales_agent:'Sales Agent',conveyancer:'Conveyancer'} as Record<string,string>)[value.role||'']||value.role;
 return [value.name,role].filter(Boolean).join(', ')+(value.name||role?` <${value.email}>`:value.email);
}
export function requireStagingEmailConfiguration(env:Record<string,string|undefined>){
 const from=env.SALES_FROM_EMAIL||env.DIGEST_FROM_EMAIL;
 if(env.NEXT_PUBLIC_SUPABASE_URL!=='https://vxkpvdtrldwwqiddoyof.supabase.co'||env.NEXT_PUBLIC_WORKSPACE_STAGING!=='1'||
  env.NEXT_PUBLIC_WORKSPACE_INTEGRATION==='1'||env.SALES_STAGING_DELIVERY_ENABLED!=='1'||env.SALES_STAGING_DELIVERY_TO!==stagingDeliveryAddress||
  (env.VERCEL&&(env.VERCEL_ENV!=='preview'||env.VERCEL_PROJECT_ID!=='prj_4s8vIyfrGh9DSGJcixTU5slevr5P'))||!env.RESEND_API_KEY||!from)
  throw Error('Staging delivery configuration is unavailable; capture retained.');
 return {key:env.RESEND_API_KEY,from};
}
export function redirectStagingEmail(mail:OriginalMail,intended:IntendedRecipients,from:string):ProviderPayload{
 if(!intended.to.length||!mail.subject||!mail.text||!mail.html||!from)throw Error('A complete original email and intended recipient are required.');
 const lines=['STAGING TEST EMAIL',...(['to','cc','bcc'] as const).filter(k=>intended[k].length).map(k=>`Intended ${k==='to'?'To':k==='cc'?'Cc':'Bcc'}: ${intended[k].map(person).join('; ')}`),`Delivered to: ${stagingDeliveryAddress}`];
 const header=`<aside aria-label="Staging delivery" style="border:2px solid #b7791f;background:#fff9e8;color:#50350b;padding:16px;margin:16px;font:14px/1.6 Arial,sans-serif">${lines.map((line,i)=>i?escape(line):`<strong>${escape(line)}</strong>`).join('<br>')}</aside>`;
 const routineHeader=`<tr><td style="padding:0 0 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;table-layout:fixed"><tr><td style="border:1px solid #d49a2d;background:#fff9e8;color:#50350b;padding:16px;font:13px/1.6 Arial,Helvetica,sans-serif;word-wrap:break-word;overflow-wrap:anywhere">${lines.map((line,i)=>i?escape(line):`<strong>${escape(line)}</strong>`).join('<br>')}</td></tr></table></td></tr>`;
 const html=mail.html.includes('<!--routine-staging-header-->')?mail.html.replace('<!--routine-staging-header-->',routineHeader):/<body\b[^>]*>/i.test(mail.html)?mail.html.replace(/<body\b[^>]*>/i,tag=>tag+header):header+mail.html;
 return {from,to:[stagingDeliveryAddress],cc:[],bcc:[],reply_to:stagingDeliveryAddress,subject:'[STAGING] '+mail.subject,text:lines.join('\n')+'\n\n'+mail.text,html,...(mail.attachments?.length?{attachments:mail.attachments}:{})};
}
export async function submitStagingEmail(payload:ProviderPayload,key:string,idempotencyKey:string,transport:typeof fetch=fetch){
 // Validate again immediately before HTTP; never accept an already-redirected
 // payload with a hidden Cc/Bcc, third-party Reply-To or a changed destination.
 if(JSON.stringify(payload.to)!==JSON.stringify([stagingDeliveryAddress])||payload.cc.length||payload.bcc.length||payload.reply_to!==stagingDeliveryAddress||!payload.subject.startsWith('[STAGING] ')||!idempotencyKey.startsWith('staging-sales/'))throw Error('Unsafe staging send rejected.');
 const response=await transport('https://api.resend.com/emails',{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
 const result=await response.json().catch(()=>({})) as {id?:string};
 if(!response.ok||!result.id)throw Error(`Provider submission failed (${response.status}).`);
 return result.id;
}
