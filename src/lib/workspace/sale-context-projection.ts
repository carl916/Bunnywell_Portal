type Fields=Record<string,unknown>;
export type SaleContextInput={sale:Fields|null;terms:Fields|null;defaults:Fields|null;attempts:Fields[]};
export type SaleContext={headline:[string,string][];buyer:[string,string][];milestones:[string,string][];basis:string;attempts:{id:string;label:string}[]};
const number=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:null;
const text=(value:unknown,empty='Not recorded')=>typeof value==='string'&&value.trim()?value:empty;
const money=(value:unknown)=>number(value)===null?'Not recorded':new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:2}).format(Number(value));
const date=(value:unknown,empty:string)=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/London'}).format(new Date(value)):empty;
export function saleContextProjection({sale,terms,defaults,attempts}:SaleContextInput):SaleContext{
 const buyer=Boolean(sale?.buyer_person_name||sale?.buyer_company_name),agreed=terms?.status==='approved';
 const price=terms?.contract_price??terms?.list_price_at_offer,source=terms||defaults||{};
 const percent=number(source.exchange_deposit_percent);
 const exchange=percent===null?'Not recorded':percent+'%'+(number(price)!==null?' · '+money(Math.round(Number(price)*percent)/100):'');
 const basis=terms?(agreed?'Approved terms':buyer?'Proposed terms':'Asking price / draft terms'):'Configured standard terms'+(defaults?'':' not recorded');
 const completed=Boolean(sale?.legal_completed_at||sale?.completed_at||sale?.workflow_status==='completed');
 const exchanged=completed||Boolean(sale?.exchanged_at);
 const reserved=exchanged||Boolean(sale?.reservation_approved_at)||['approved','reservation_approved','awaiting_commercial_approval','ready_for_exchange'].includes(String(sale?.workflow_status));
 const ended=sale?.workflow_status==='fallen_through',contactEmpty=!sale?'Not applicable':buyer?'Not recorded':'No buyer recorded';
 return {basis,headline:[[agreed?'Agreed price':buyer?'Proposed price':'Asking price',money(price)],['Reservation fee',money(source.reservation_fee)],['Exchange deposit · expected',exchange]],
 buyer:[['Buyer name',text(sale?.buyer_person_name||sale?.buyer_company_name,!sale?'No buyer yet':'Not recorded')],['Buyer email',text(sale?.buyer_email,contactEmpty)],['Buyer phone',text(sale?.buyer_phone,contactEmpty)],["Buyer’s solicitor",text(sale?.buyer_solicitor_name,!sale?'Not appointed':'Not recorded')],['Solicitor email',text(sale?.buyer_solicitor_email,!sale?'Not applicable':'Not recorded')],['Solicitor phone',text(sale?.buyer_solicitor_phone,!sale?'Not applicable':'Not recorded')]],
 milestones:[['Reservation date',date(sale?.reservation_date,reserved?'Date not recorded':ended?'Not applicable':'Not yet reserved')],['Exchange date',date(sale?.exchanged_at,exchanged?'Date not recorded':ended?'Not applicable':'Not yet exchanged')],['Completion due date',date(sale?.contractual_completion_date,completed?'Date not recorded':ended?'Not applicable':'Not set')],['Actual completion date',date(sale?.legal_completed_at||sale?.completed_at,completed?'Date not recorded':ended?'Not applicable':'Not yet completed')]],
 attempts:attempts.map(a=>({id:String(a.id),label:(a.is_active?'Current reservation':'Previous reservation')+(a.reservation_date?' · '+date(a.reservation_date,'Date not recorded'):'')+' · '+String(a.workflow_status).replaceAll('_',' ')}))};
}
