import {deliverSalesEmails} from './sales-email-delivery';
import 'server-only';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {createSupabaseServiceRoleClient} from '@/lib/supabase/admin';
import {hostedStaging,stagingEnabled,stagingOrigin} from './staging';
import {selectEmailNotificationRecipients,type NotificationContext} from './email-notifications';
import {resolveEmailNotificationRecipients} from './email-notifications-server';
import {renderNotificationEmail,type NotificationBatch,type EligibleItem} from './notification-email';

export function dispatchAuthorised(header:string|null){
 const secret=process.env.SALES_NOTIFICATION_DISPATCH_SECRET;
 if(!hostedStaging||!stagingEnabled()||!secret||secret.length<32)return false;
 const received=Buffer.from(header||''),expected=Buffer.from('Bearer '+secret);
 return received.length===expected.length&&timingSafeEqual(received,expected);
}
export async function dispatchNotifications(){
 if(!hostedStaging||!stagingEnabled())throw Error('Staging capture is unavailable.');
 const worker=randomUUID();
 // Queue access remains restricted; delivery uses a separate final redirect boundary.
 const guarded:typeof fetch=async(input,options)=>{
  const target=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  const method=(options?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
  const raw=options?.body??(input instanceof Request?await input.clone().text():null);
  const body=typeof raw==='string'?JSON.parse(raw):null;
  if(target!==stagingOrigin+'/rest/v1/rpc/workspace_notification_worker'||method!=='POST'||body?.p_worker!==worker)throw Error('Notification capture egress rejected.');
  return fetch(input,{...options,redirect:'error'});
 };
 const client=createSupabaseServiceRoleClient(guarded);
 async function command(action:string,payload:Record<string,unknown>={}){
  const {data,error}=await client.rpc('workspace_notification_worker',{p_worker:worker,p_action:action,p_payload:{...payload,protocol:3}});
  if(error)throw Error(`Notification ${action} failed (${error.code}).`);
  return data;
 }
 const claim=await command('claim');
 if(!claim?.claimed)return {claimed:false,externalDelivery:false};
 const result={claimed:true,events:0,captured:0,suppressed:0,externalDelivery:false};
 const deadline=Date.now()+20000;
 try{
  while(Date.now()<deadline&&result.events<200){
   const event=await command('next_event') as {id:string;event_id:string;audience:NotificationContext}|null;
   if(!event)break;
   const recipients=selectEmailNotificationRecipients(event.audience,event.event_id);
   await command('fanout',{eventId:event.id,recipientIds:recipients.map(r=>r.userId)});result.events++;
  }
  while(Date.now()<deadline&&result.captured+result.suppressed<100){
   const batch=await command('next_batch') as NotificationBatch|null;
   if(!batch)break;
   const items:EligibleItem[]=[];
   for(const event of batch.events){
    if(!batch.enrolled||!event.current)continue;
    const initial=selectEmailNotificationRecipients(event.audience,event.eventId).find(r=>r.userId===batch.recipientId);
    const current=(await resolveEmailNotificationRecipients(event.eventId,batch.saleId,event.commentId)).find(r=>r.userId===batch.recipientId);
    const reasons=initial?.eventIds.filter(id=>current?.eventIds.includes(id))||[];
    if(reasons.length)items.push({eventId:event.id,reasons});
   }
   const response=await command('capture',{batchId:batch.batchId,revision:batch.revision,items,mail:renderNotificationEmail(batch,items)});
   if(response.status==='captured')result.captured++;else if(response.status==='suppressed')result.suppressed++;
  }
  await command('release',result);
  const delivery=await deliverSalesEmails();
  return {...result,delivery};
 }catch(error){
  // Durable pending work survives failures. Never log addresses or comment text.
  await command('release',{...result,failed:true}).catch(()=>{});
  throw error;
 }
}
