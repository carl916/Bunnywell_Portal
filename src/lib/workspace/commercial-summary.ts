import { calculateAgentInvoicePreview, calculateDeveloperNet } from "@/lib/sales/commercial-model";
import { buildDepositStructure, buildPaymentScheduleRows, describeReservationFeeHolder } from "@/lib/sales/deal-structure";
import { timingDescription, type FurtherDepositTiming } from "@/lib/sales/further-deposit";
import { canViewDeveloperCommercials } from "@/lib/sales/permissions";

export type CommercialSummary = {
  version: number; status: string;
  groups: { id: string; title: string; fields: [string, string][] }[];
  notes: string[];
};
const money = (value: number | null) => value === null ? "Not recorded" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);

// The authorised workspace commercial view includes all three summaries for
// conveyancers. This does not grant edit or Agent Fees module permissions.
export function commercialSummary(terms: Record<string, unknown>, role: string): CommercialSummary {
  const n = (key: string) => typeof terms[key] === "number" && Number.isFinite(terms[key]) ? terms[key] as number : null;
  const price=n("contract_price"), fee=n("reservation_fee"), internal=canViewDeveloperCommercials(role)||role==='conveyancer';
  const summary: CommercialSummary = { version: n("version_number") || 1, status: String(terms.status || "draft"), groups: [], notes: [] };
  const group = (id: string, title: string, fields: [string,string][]) => summary.groups.push({id,title,fields});
  if (internal) {
    const netInputs=[price,n("parking_value"),n("developer_contribution"),n("solicitor_fee"),n("agent_fee_percent")];
    const net=netInputs.every(value=>value!==null)?calculateDeveloperNet({contractPrice:price,parkingValue:n("parking_value"),developerContribution:n("developer_contribution"),solicitorFee:n("solicitor_fee"),agentFeePercent:n("agent_fee_percent")}):null;
    group("developer","Developer",[["Contract price",money(price)],["Parking value",money(n("parking_value"))],["Developer contribution",money(n("developer_contribution"))],["Solicitor fee",money(n("solicitor_fee"))],["Net developer proceeds before other costs",money(net)]]);
    summary.notes.push("Developer proceeds follow the existing commercial model: contract price plus parking value, less developer contribution, solicitor fee and agent fee excluding VAT. Other costs and VAT are not deducted in this figure.");
  }
  if (internal || role === "sales_agent") {
    const totalPercent=n('agent_fee_percent');
    const total=price!==null&&totalPercent!==null&&n('vat_rate')!==null?calculateAgentInvoicePreview({contractPrice:price,agentFeePercent:totalPercent,vatRate:n('vat_rate'),reservationFee:0,agentContribution:0}):null;
    const fields: [string,string][] = [["Total agent fee (incl. VAT)",total?money(total.grossAmount)+' · '+totalPercent+'% + VAT':"Not recorded"]];
    for (const [milestone, title] of [["exchange","Exchange"],["completion","Completion"]]) {
      const percent=n(milestone+"_agent_fee_percent") ?? (milestone==="exchange"?n("agent_fee_percent"):null);
      if (price===null || percent===null || n("vat_rate")===null) { fields.push([title+" fee","Not recorded"]); continue; }
      const value=calculateAgentInvoicePreview({contractPrice:price,agentFeePercent:percent,vatRate:n("vat_rate"),reservationFee:milestone==="exchange"?fee:0,reservationFeeHolder:String(terms.reservation_fee_holder),agentContribution:milestone==="exchange"?n("agent_contribution"):0});
      fields.push([title+" fee (incl. VAT)",money(value.grossAmount)+' · '+percent+'% + VAT']);
      if(milestone==="exchange"){
        if(value.reservationFeeDeduction)fields.push(["Reservation fee held by agent",money(value.reservationFeeDeduction)]);
        if(value.agentContributionDeduction)fields.push(["Agent-funded contribution deduction",money(value.agentContributionDeduction)]);
      }
      fields.push([title+" expected cash payable",money(value.expectedPayableAmount)]);
    }
    group("agent","Agent",fields);
  }
  const buyer: [string,string][] = [["Contract price",money(price)],["Reservation fee",money(fee)],["Reservation fee holder",describeReservationFeeHolder(String(terms.reservation_fee_holder))]];
  const input={contractPrice:price,exchangeDepositPercent:n("exchange_deposit_percent"),secondDepositEnabled:terms.second_deposit_enabled===true,secondDepositPercent:n("second_deposit_percent"),secondDepositMonthsAfterExchange:n("second_deposit_months_after_exchange"),furtherDepositTiming:terms.further_deposit_timing as FurtherDepositTiming|null};
  const structure=buildDepositStructure(input);
  if(n("exchange_deposit_percent")===null || typeof terms.second_deposit_enabled!=="boolean" || !structure.isValid) {
    buyer.push(["Payment schedule",structure.error || "Deposit structure not recorded"]);
  } else {
    const schedule=buildPaymentScheduleRows(input);
    for(const row of schedule)buyer.push([row.label,money(row.expectedAmount)]);
    buyer.push(["Further deposit due",input.secondDepositEnabled?timingDescription(input.furtherDepositTiming,input.secondDepositMonthsAfterExchange):"Not required"]);
    summary.notes.push("The reservation fee is included in the exchange deposit. The schedule shows expected payments, not evidence of receipt.");
    if(price!==null && schedule.reduce((sum,row)=>sum+Math.round((row.expectedAmount||0)*100),0)!==Math.round(price*100))summary.notes.push("The recorded percentage schedule has a penny rounding difference. Refer to the current Completion statement for the final settlement balance.");
  }
  group("buyer","Buyer · payment schedule",buyer);
  if(summary.status!=="approved")summary.notes.unshift("These terms are "+summary.status.replaceAll("_"," ")+". Viewing them does not approve them.");
  return summary;
}
