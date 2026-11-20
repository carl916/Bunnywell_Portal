import {calculateAgentInvoicePreview} from './commercial-model';
import {deriveInvoicePaymentPosition,fromPence,toPence,type AgentFeeMilestone,type AgentFeePayment} from './agent-fees';

type Terms={contract_price?:number|null;exchange_agent_fee_percent?:number|null;completion_agent_fee_percent?:number|null;agent_fee_percent?:number|null;vat_rate?:number|null;reservation_fee?:number|null;reservation_fee_holder?:string|null;agent_contribution?:number|null};
export function milestoneInvoiceAmounts(terms:Terms,milestone:AgentFeeMilestone){
 const feePercent=Number(milestone==='exchange'?terms.exchange_agent_fee_percent??terms.agent_fee_percent:terms.completion_agent_fee_percent);
 return {...calculateAgentInvoicePreview({contractPrice:terms.contract_price,agentFeePercent:feePercent,vatRate:terms.vat_rate,reservationFee:milestone==='exchange'?terms.reservation_fee:0,reservationFeeHolder:terms.reservation_fee_holder,agentContribution:milestone==='exchange'?terms.agent_contribution:0}),feePercent};
}
export type ExpectedInvoice=ReturnType<typeof milestoneInvoiceAmounts>;
const known=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
export function expectedMilestoneInvoice(terms:Terms|null,milestone:AgentFeeMilestone):ExpectedInvoice|null{
 const percent=milestone==='exchange'?terms?.exchange_agent_fee_percent??terms?.agent_fee_percent:terms?.completion_agent_fee_percent;
 if(!terms||!known(terms.contract_price)||!known(percent)||!known(terms.vat_rate))return null;
 if(milestone==='exchange'&&(!known(terms.agent_contribution)||!terms.reservation_fee_holder||terms.reservation_fee_holder==='sales_agent'&&!known(terms.reservation_fee)))return null;
 return milestoneInvoiceAmounts(terms,milestone);
}
export type InvoiceFinancials={gross_amount:number|null;expected_gross_amount:number|null;reservation_fee_deduction:number|null;agent_contribution_deduction:number|null;expected_payable_amount:number|null};
export function invoiceFinancialSummary(expected:ExpectedInvoice|null|undefined,invoice:InvoiceFinancials|undefined,payments:AgentFeePayment[]){
 // Submitted invoices retain their recorded expectation, even if terms change.
 const gross=invoice?invoice.expected_gross_amount:expected?.grossAmount;
 const payable=invoice?invoice.expected_payable_amount:expected?.expectedPayableAmount;
 const reservation=invoice?invoice.reservation_fee_deduction:expected?.reservationFeeDeduction;
 const contribution=invoice?invoice.agent_contribution_deduction:expected?.agentContributionDeduction;
 const position=known(payable)?deriveInvoicePaymentPosition({cashAmountPayable:payable,reservationFeeHeld:reservation,payments}):null;
 return {expectedGross:known(gross)?gross:null,reservation:known(reservation)?reservation:null,contribution:known(contribution)?contribution:null,payable:known(payable)?payable:null,
  actual:known(invoice?.gross_amount)?invoice.gross_amount:null,variance:known(invoice?.gross_amount)&&known(gross)?fromPence(toPence(invoice.gross_amount)-toPence(gross)):null,position};
}
