import {invoiceFinancialSummary,type ExpectedInvoice,type InvoiceFinancials} from '@/lib/sales/agent-invoice-summary';
import type {AgentFeeMilestone,AgentFeePayment} from '@/lib/sales/agent-fees';
import f from './AgentFees.module.css';

const money=(value:number|null)=>value===null?'Unavailable':new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(value);
function Amounts({rows}:{rows:{label:string;value:number|null;total?:boolean;signed?:boolean}[]}){
 return <dl className={f.amounts}>{rows.map(row=><div key={row.label} data-total={row.total||undefined}><dt>{row.label}</dt><dd>{row.signed&&row.value!==null&&row.value>0?'+':''}{money(row.value)}</dd></div>)}</dl>;
}
export default function InvoiceFinancialSummary({expected,invoice,payments,milestone}:{expected?:ExpectedInvoice|null;invoice?:InvoiceFinancials;payments:AgentFeePayment[];milestone:AgentFeeMilestone}){
 const value=invoiceFinancialSummary(expected,invoice,payments);
 const deductions=milestone==='exchange'||Boolean(value.reservation||value.contribution);
 return <div className={f.summary}>
  <section aria-label="Expected financial figures"><h3>Expected figures</h3><Amounts rows={[
   {label:'Expected agent invoice',value:value.expectedGross},
   ...(deductions?[{label:'Less: Reservation fee held',value:value.reservation===null?null:value.reservation?-value.reservation:0},{label:'Less: Agent contribution',value:value.contribution===null?null:value.contribution?-value.contribution:0}]:[]),
   {label:'Expected cash payable',value:value.payable,total:true},
  ]}/>{value.expectedGross===null&&<p className={f.hint}>Expected figures are unavailable until the commercial terms are recorded.</p>}</section>
  {invoice&&<div className={f.settlement}><section aria-label="Submitted invoice figures"><h3>Submitted invoice</h3><Amounts rows={[{label:'Actual invoice amount',value:value.actual},{label:'Difference from expected',value:value.variance,signed:true}]}/>{value.variance!==null&&value.variance!==0&&<p className={f.hint}>The submitted total differs from the expected invoice. Expected cash payable is unchanged.</p>}</section>
   <section aria-label="Payment summary"><h3>Payment summary</h3><Amounts rows={[{label:'Expected cash payable',value:value.payable},{label:'Payments recorded',value:value.position?.cashReceived??null},{label:'Outstanding',value:value.position?.outstandingBalance??null,total:true}]}/></section>
  </div>}
 </div>;
}
