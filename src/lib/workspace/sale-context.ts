import type {Viewer} from './server';
import {ReadError} from './server';
import {rows} from './reads';
import {validId} from '@/lib/experiments/building-contracts/contracts';
import {moduleAllowed} from './staging';
import {saleContextProjection,type SaleContextInput} from './sale-context-projection';

// A single caller-authorised read for persistent sale context. No document
// signing, invoices, receipts or privileged command RPCs are needed here.
export async function saleContext(v:Viewer,p:URLSearchParams){
 const building=p.get('building')||'',unit=p.get('unit')||'',sale=p.get('sale')||'';
 if(!moduleAllowed(v.profile.role,'sales')||![building,unit].every(validId)||sale&&!validId(sale))throw new ReadError('Invalid sale context.',400);
 const [[b],[u],attempts]=await Promise.all([
  rows<Record<string,unknown>>(v.client,'buildings','id',q=>q.eq('id',building)),
  rows<Record<string,unknown>>(v.client,'units','id,building_id,sale_status',q=>q.eq('id',unit).eq('building_id',building)),
  rows<Record<string,unknown>>(v.client,'unit_sale_attempts','id,is_active,attempt_number,workflow_status,buyer_person_name,buyer_company_name,buyer_email,buyer_phone,buyer_solicitor_name,buyer_solicitor_email,buyer_solicitor_phone,reservation_date,reservation_approved_at,commercial_approved_at,exchanged_at,completed_at,legal_completed_at,contractual_completion_date',q=>q.eq('building_id',building).eq('unit_id',unit).is('redacted_at',null))
 ]);
 if(!b||!u)throw new ReadError('Unit unavailable for this account.');
 const attempt=sale?attempts.find(a=>a.id===sale):null;
 if(sale&&!attempt||!sale&&attempts.some(a=>a.is_active))throw new ReadError('Open the exact current sale.');
 const [terms,defaults]=await Promise.all([
  sale?rows<Record<string,unknown>>(v.client,'unit_sale_terms','id,status,contract_price,list_price_at_offer,reservation_fee,exchange_deposit_percent',q=>q.eq('sale_attempt_id',sale).eq('is_current',true)):Promise.resolve([]),
  v.client.from('building_sale_defaults').select('reservation_fee,exchange_deposit_percent').eq('building_id',building).maybeSingle().then(({data,error})=>{if(error)throw new ReadError('Configured sale terms could not be loaded.',503);return data as Record<string,unknown>|null;})
 ]);
 if(terms.length>1)throw new ReadError('More than one current terms version needs reconciliation.',409);
 return saleContextProjection({sale:attempt||null,terms:terms[0]||null,defaults,attempts} as SaleContextInput);
}
