import 'server-only';
import {randomUUID} from 'node:crypto';
import {createSupabaseServiceRoleClient} from '@/lib/supabase/admin';
import {hostedStaging,stagingEnabled,stagingOrigin} from './staging';
import {eligibleNotificationItems,renderNotificationEmail,type NotificationBatch,type EligibleItem} from './notification-email';
import {readStagingEmailStatus,redirectStagingEmail,requireStagingEmailConfiguration,stagingEmailFailure,submitStagingEmail,type OriginalMail,type IntendedRecipients,type ProviderPayload} from './staging-email';

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
 const summary={accepted:0,delivered:0,retryPending:0,failed:0,reconciliationRequired:0,suppressed:0};
 const deadline=Date.now()+20000;
 let poll=true;
 for(let i=0;i<limit&&Date.now()<deadline;i++){
  const d=await command('claim',{id,poll}) as Delivery|null;if(!d)break;
  if(d.provider_id)poll=false;
  try{
   const config=requireStagingEmailConfiguration(process.env);
   if(d.provider_id){
    const status=await readStagingEmailStatus(d.provider_id,config.key);
    await command('result',{id:d.id,providerId:d.provider_id,...status});
    if(status.status==='delivered')summary.delivered++;continue;
   }
   let mail=d.original_mail,intended=d.intended;let items:EligibleItem[]=[];
   if(d.kind==='routine'&&d.context){
    const batch=d.context;
    items=eligibleNotificationItems(batch);
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
   const failure=stagingEmailFailure(error);
   const saved=await command('result',{id:d.id,...failure,status:d.provider_id?'accepted':failure.status,providerId:d.provider_id});
   if(saved.status==='retry_pending')summary.retryPending++;
   if(saved.status==='failed')summary.failed++;
   if(saved.status==='reconciliation_required')summary.reconciliationRequired++;
  }
 }
 return summary;
}
