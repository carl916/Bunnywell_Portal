import type {NotificationContext} from './email-notifications';
import {escapeHtml as escape} from '../email/layout';

export type QueuedEvent={details?:Record<string,unknown>|null;id:string;eventId:string;occurredAt:string;occurrence?:string|null;label?:string;commentId:string|null;audience:NotificationContext;current:NotificationContext|null;comment:{body:string;author:string;version:number;createdAt:string}|null};
export type NotificationBatch={batchId:string;recipientId:string;saleId:string;buildingId:string;unitId:string;building:string;unit:string;email:string;recipientName?:string;recipientRole?:string;openedAt:string;dueAt:string;revision:string;enrolled:boolean;events:QueuedEvent[]};
export type EligibleItem={eventId:string;reasons:string[]};
const portalOrigin='https://staging.bunnywell.co.uk';
export function notificationLink(batch:NotificationBatch,commentId?:string|null,section='reservation'){
 const query=new URLSearchParams({view:'sale',building:batch.buildingId,unit:batch.unitId,sale:batch.saleId,section});
 if(commentId)query.set('comment',commentId);
 return portalOrigin+'/workspace?'+query;
}
const wording:Record<string,[string,string,string]>={
 reservation_submitted:['Reservation ready for review','reservation','View reservation'],
 reservation_approved:['Reservation approved','reservation','View reservation'],
 reservation_queried:['Reservation needs attention','reservation','View reservation'],
 exchange_authority_requested:['Authority to exchange requested','exchange','View exchange'],
 exchange_authority_expired:['Authority to exchange expired','exchange','View exchange'],
 exchange_authority_revoked:['Authority to exchange revoked','exchange','View exchange'],
 unit_exchanged:['Contracts exchanged','exchange','View exchange'],
 notice_authority_requested:['Authority to serve notice requested','completion','View completion'],
 contractual_completion_date_changed:['Contractual completion date updated','completion','View completion'],
 completion_documents_uploaded:['Completion documents uploaded','completion','View completion documents'],
 completion_document_queried:['Completion document needs attention','completion','View completion documents'],
 completion_documents_approved:['Completion documents approved','completion','View completion documents'],
 unit_legally_completed:['Sale legally completed','completion','View completion'],
 handover_completed:['Handover completed','handover','View handover'],
 sale_fallen_through:['Sale fallen through','reservation','View ended sale'],
};
function titleFor(event:QueuedEvent){
 if(event.details?.noticeRecorded===true)return 'Notice recorded and contractual deadline confirmed';
 if(event.eventId==='reservation_submitted'){
  if(event.occurrence==='reservation_submitted')return 'Reservation submitted';
  if(event.occurrence==='reservation_resubmitted')return 'Reservation resubmitted';
 }
 if(event.eventId==='reservation_queried'){
  if(event.occurrence==='reservation_rejected')return 'Reservation rejected';
  if(event.occurrence==='reservation_query_raised')return 'Reservation query raised';
 }
 if(event.eventId==='completion_documents_uploaded'&&event.occurrence){
  const document=event.occurrence.startsWith('completion_draft_statement_of_account_')?'Draft statement of account':event.occurrence.startsWith('completion_statement_')?'Completion statement':null;
  if(document)return document+(event.occurrence.endsWith('_replaced')?' replaced':' uploaded');
 }
 const value=wording[event.eventId];if(!value)throw Error('Unknown notification event.');return value[0];
}
const ukDate=(value:unknown,time=false)=>typeof value==='string'&&value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',...(time?{hour:'2-digit',minute:'2-digit'}:{}),timeZone:'Europe/London'}).format(new Date(value)):'';
function eventDetails(event:QueuedEvent){
 const d=event.details||{},lines:string[]=[];
 const add=(label:string,value:unknown)=>{if(typeof value==='string'&&value.trim()&&!['undefined','null'].includes(value))lines.push(label+': '+value)};
 const when=event.eventId==='unit_exchanged'?d.exchangeDate:event.eventId==='unit_legally_completed'?d.completionDate:null;
 add(when?(event.eventId==='unit_exchanged'?'Actual exchange date':'Actual completion date'):'Event recorded',ukDate(when||event.occurredAt,!when||typeof when==='string'&&when.includes('T')));
 if(['unit_exchanged','unit_legally_completed'].includes(event.eventId))add('Purchaser',d.purchaser);
 if(event.eventId==='contractual_completion_date_changed'){
  add('Previous completion date',ukDate(d.oldDate));add('Contractual completion date',ukDate(d.newDate));
  add('Notice issue date',ukDate(d.noticeDate));add('Valid service date',ukDate(d.serviceDate));
  if(d.basis==='fixed_date')add('Completion basis','Fixed-date agreement');
 }
 if(event.eventId==='completion_documents_uploaded'){
  add('Document',d.documentType==='completion_statement'?'Completion statement':d.documentType==='draft_statement_of_account'?'Draft statement of account':null);
  if(typeof d.fileName==='string'&&!/[\x00-\x1f/\\]/.test(d.fileName))add('Filename',d.fileName);
  if(d.versionNumber)add('Version',String(d.versionNumber));
 }
 add(event.eventId==='completion_documents_uploaded'?'Uploaded by':event.eventId==='contractual_completion_date_changed'&&d.noticeRecorded!==true?'Updated by':'Recorded by',d.actor);
 return lines.join('\n');
}

/** Uses only recipient-eligible events. No delivery or additional data access. */
export function renderNotificationEmail(batch:NotificationBatch,items:EligibleItem[]){
 const matched=new Map(items.map(item=>[item.eventId,item]));
 const selected=batch.events.filter(event=>matched.has(event.id));
 const comments=new Map<string,{event:QueuedEvent;mention:boolean}>();
 for(const event of selected){
  if(!event.commentId||!event.comment)continue;
  const prior=comments.get(event.commentId);
  comments.set(event.commentId,{event,mention:Boolean(prior?.mention||matched.get(event.id)?.reasons.includes('comment_mentioned'))});
 }
 const heading=`${batch.building} · Unit ${batch.unit}`;
 const sections:{title:string;body:string;link:string;action:string;comment:boolean}[]=[];
 for(const event of selected){
  if(event.commentId)continue;
  const title=titleFor(event),[,section,action]=wording[event.eventId];
  sections.push({title,body:[event.eventId==='sale_fallen_through'?'This sale attempt ended. This link opens its history.':'',eventDetails(event)].filter(Boolean).join('\n'),link:notificationLink(batch,null,section),action,comment:false});
 }
 const workflowCount=sections.length,mentions=[...comments.values()].filter(c=>c.mention).length;
 for(const {event,mention} of comments.values()){
  sections.push({title:`${event.comment!.author||'Someone'} ${mention?'mentioned you':'added a comment'}`,body:event.comment!.body,link:notificationLink(batch,event.commentId),action:'View comment',comment:true});
 }
 const count=(n:number,singular:string)=>`${n} ${singular}${n===1?'':'s'}`;
 const commentSummary=[mentions?count(mentions,'mention'):'',comments.size>mentions?count(comments.size-mentions,'comment'):''].filter(Boolean).join(' and ');
 const summary=workflowCount===1?sections[0].title+(commentSummary?' and '+commentSummary:''):workflowCount>1?count(workflowCount,'sale update')+(commentSummary?' and '+commentSummary:''):commentSummary||'Sale update';
 const subject=`${heading} — ${summary}`;
 const primary=sections.find(section=>section.comment)||sections[0];
 const link=primary?.link||notificationLink(batch),actionLabel=sections.length>1?'View sale workspace':primary?.action||'View sale';
 const text=[heading,...sections.map(section=>[section.title,section.body?section.comment?'“'+section.body+'”':section.body:''].filter(Boolean).join('\n')),actionLabel+': '+link].join('\n\n');
 const content=sections.map(section=>{
  return `<tr><td style="padding:22px 0;border-top:1px solid #e2ded3;word-wrap:break-word;overflow-wrap:anywhere"><h2 style="margin:0;color:#0f3d2e;font-size:18px;line-height:1.4">${escape(section.title)}</h2>${section.body?`<p style="margin:12px 0 0;font-size:15px;line-height:1.6;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere">${section.comment?'“':''}${escape(section.body)}${section.comment?'”':''}</p>`:''}</td></tr>`;
 }).join('')+`<tr><td style="padding:16px 0"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#0f3d2e" style="border-radius:6px;mso-padding-alt:14px 20px"><a href="${escape(link)}" style="display:inline-block;padding:14px 20px;background:#0f3d2e;color:#ffffff;border-radius:6px;font-size:14px;font-weight:700;text-decoration:none">${escape(actionLabel)}</a></td></tr></table></td></tr>`;
 // Authority email's table structure, colours, width and mobile gutters.
 // The staging wrapper fills the slot inside the centred table.
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head><body style="margin:0;padding:0;background:#f6f1e7;font-family:Arial,Helvetica,sans-serif;color:#1f2a24"><div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${escape(subject)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f6f1e7" style="width:100%;border-collapse:collapse"><tr><td align="center" style="padding:24px 12px"><!--[if mso]><table role="presentation" width="640" align="center"><tr><td><![endif]--><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;border-collapse:collapse;table-layout:fixed"><!--routine-staging-header--><tr><td style="padding:0 12px 22px"><p style="margin:0;color:#d49a2d;font-size:13px;letter-spacing:4px;font-weight:700">BUNNYWELL</p><p style="margin:4px 0 0;color:#0f3d2e;font-size:27px;font-weight:700">Portal</p></td></tr><tr><td bgcolor="#ffffff" style="padding:28px 24px;border:1px solid #e2ded3;background:#ffffff;word-wrap:break-word;overflow-wrap:anywhere"><h1 style="margin:0 0 22px;color:#0f3d2e;font-size:26px;line-height:1.25">${escape(heading)}</h1><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;table-layout:fixed">${content}</table></td></tr></table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
 return {subject,html,text};
}
