import 'server-only';
import {randomUUID} from 'node:crypto';
import {createSupabaseServiceRoleClient} from '@/lib/supabase/admin';
import {hostedStaging,stagingEnabled,stagingOrigin} from './staging';
import {selectEmailNotificationRecipients} from './email-notifications';
import {renderNotificationEmail,type NotificationBatch,type EligibleItem} from './notification-email';
import {redirectStagingEmail,requireStagingEmailConfiguration,submitStagingEmail,type OriginalMail,type IntendedRecipients,type ProviderPayload} from './staging-email';

type Delivery={id:string;kind:'routine'|'legal';source_id:string;recipient_id:string;original_mail:OriginalMail;intended:IntendedRecipients;context:NotificationBatch|null;provider_id:string|null;provider_payload:ProviderPayload|null;first_attempt_at:string|null};
export async function deliverSalesEmails(id?:string,limit=20){
 if(!hostedStaging||!stagingEnabled())throw Error('Staging delivery is unavailable.');
 const worker=randomUUID();
 const guarded:typeof fetch=async(input,options)=>{
  const target=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  const raw=options?.body;const body=typeof raw==='string'?JSON.parse(raw):null;
  if(target!==stagingOrigin+'/rest/v1/rpc/workspace_sales_email_delivery'||options?.method?.toUpperCase()!=='POST'||body?.p_worker!==worker)throw Error('Sales delivery database boundary rejected.');
  return fetch(input,{...options,redirect:'error'});
 };
 const client=createSupabaseServiceRoleClient(guarded);
 async function command(action:string,payload:Record<string,unknown>){
  const {data,error}=await client.rpc('workspace_sales_email_delivery',{p_worker:worker,p_action:action,p_payload:payload});
  if(error)throw Error(`Sales delivery ${action} failed (${error.code}).`);return data;
 }
 const summary={accepted:0,delivered:0,failed:0,suppressed:0};const deadline=Date.now()+20000;
 for(let i=0;i<limit&&Date.now()<deadline;i++){
  const d=await command('claim',{id}) as Delivery|null;if(!d)break;
  try{
   const config=requireStagingEmailConfiguration(process.env);
   if(d.provider_id){
    const response=await fetch('https://api.resend.com/emails/'+encodeURIComponent(d.provider_id),{headers:{Authorization:`Bearer ${config.key}`},redirect:'error',signal:AbortSignal.timeout(10000)});
    const data=await response.json().catch(()=>({})) as {last_event?:string};
    const status=response.ok&&['delivered','bounced','complained','failed'].includes(data.last_event||'')?data.last_event!:'accepted';
    if(!response.ok)console.warn('sales-email provider status lookup unavailable',{deliveryId:d.id,httpStatus:response.status});
    await command('result',{id:d.id,status,providerId:d.provider_id,...(!response.ok?{error:`Provider status unavailable (${response.status}).`}:{})});
    if(status==='delivered')summary.delivered++;continue;
   }
   let mail=d.original_mail,intended=d.intended;const items:EligibleItem[]=[];
   if(d.kind==='routine'&&d.context){
    const batch=d.context;
    for(const event of batch.events){
     if(!batch.enrolled||!event.current)continue;
     const initial=selectEmailNotificationRecipients(event.audience,event.eventId).find(r=>r.userId===batch.recipientId);
     const current=selectEmailNotificationRecipients(event.current,event.eventId).find(r=>r.userId===batch.recipientId);
     const reasons=initial?.eventIds.filter(x=>current?.eventIds.includes(x))||[];
     if(reasons.length)items.push({eventId:event.id,reasons});
    }
    mail=renderNotificationEmail(batch,items);
    intended={to:[{email:batch.email,name:batch.recipientName,role:batch.recipientRole}],cc:[],bcc:[]};
   }
   const payload=d.provider_payload||redirectStagingEmail(mail,intended,config.from);
   const released=await command('release_for_send',{id:d.id,revision:d.context?.revision,items,mail,providerPayload:payload});
   if(!released.send){summary.suppressed++;continue;}
   const providerId=await submitStagingEmail(released.payload,config.key,released.idempotencyKey);
   await command('result',{id:d.id,status:'accepted',providerId});summary.accepted++;
  }catch(error){
   // Treat a timeout/transport ambiguity as unknown. The immutable payload and
   // original identity are retried only inside Resend's safe idempotency window.
   const message=error instanceof Error?error.message:'Delivery unavailable.';
   const definiteFailure=message.startsWith('Staging delivery configuration')||message.startsWith('Unsafe')||/Provider submission failed \((?:4\d\d)\)/.test(message)&&!message.includes('(409)');
   await command('result',{id:d.id,status:d.provider_id?'accepted':definiteFailure?'failed':'unknown',providerId:d.provider_id,error:message}).catch(()=>{});summary.failed++;
  }
 }
 return summary;
}
