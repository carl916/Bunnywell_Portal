import type {SaleRow} from '@/lib/experiments/building-contracts/contracts';
import {canPerformSalesAction,type SalesStageAction} from '@/lib/sales/permissions';
import {saleActionDestination} from './completion-navigation';

// Wording and navigation over existing progression/permission projections only.
export function saleGuidance(row:SaleRow,role:string,section:string,task:string){
 const p=row.progression;
 if(!p||row.historical||p.stages.completion==='complete'||p.stages[section]==='complete'||section==='completion'&&p.steps[task]==='complete')return null;
 const destination=p.destination;
 if(section==='completion'&&task==='legal'&&destination.task==='documents')return null;
 let title=p.next,permission:SalesStageAction='submit_reservation';
 if(destination.section==='reservation')permission=title==='Review reservation'?'approve_reservation':'submit_reservation';
 if(destination.section==='exchange'){
  if(title==='Record exchange')permission='record_exchange';
  else if(canPerformSalesAction(role,'approve_exchange')){permission='approve_exchange';title='Give authority to exchange';}
  else permission=title==='Review exchange authority request'?'approve_exchange':'request_exchange_approval';
 }
 if(destination.section==='completion'){
  if(destination.task==='authority'){
   if(canPerformSalesAction(role,'approve_exchange')){permission='approve_exchange';title='Give authority to serve notice';}
   else permission=title.startsWith('Give')?'approve_exchange':'request_exchange_approval';
  }else if(destination.task==='notice')permission='confirm_completion_arrangements';
  else if(destination.task==='legal')permission='record_completion';
  else {
   const reviewAvailable=row.actions.some(a=>a.existingCapability&&a.kind.startsWith('review_')&&saleActionDestination(a.kind,a.destination.anchor).task==='documents');
   permission=title==='Review completion documents'||reviewAvailable?'approve_completion_documents':'submit_completion_documents';
   if(reviewAvailable)title='Review completion documents';
  }
 }
 const canAct=canPerformSalesAction(role,permission);
 const selected=section===destination.section&&(section!=='completion'||task===destination.task);
 if(!selected||canAct)return null;
 const owners:Partial<Record<SalesStageAction,string>>={submit_reservation:'sales agent or developer',approve_reservation:'developer',approve_exchange:'developer',request_exchange_approval:'sales agent or conveyancer',record_exchange:'conveyancer',confirm_completion_arrangements:'conveyancer',submit_completion_documents:'conveyancer',approve_completion_documents:'developer',record_completion:'conveyancer'};
 const waiting=canAct?null:`Waiting for the ${owners[permission]||p.responsible.toLowerCase()} to ${title.replace(/^Review exchange authority request$/,'give authority to exchange').replace(/^Prepare reservation and commercial terms$/,'prepare the reservation').toLowerCase()}.`;
 return {title,waiting,destination,selected};
}
