import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardInput } from "@/lib/dashboard/types";
import { readComplete } from "@/lib/dashboard/pagination";
import { feePortfolioFromSales } from "@/lib/sales/fee-portfolio-data";
type Query = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;
export async function rows<T>(client:SupabaseClient, table:string, columns:string, filter:(q:Query)=>Query = q=>q):Promise<T[]> {
 return readComplete<T>(async(from,to)=>{const r=await filter(client.from(table).select(columns,{count:"exact"})).order("id").range(from,to);return {...r,data:r.data as T[]|null}});
}
export async function related<T>(client:SupabaseClient,table:string,columns:string,key:string,ids:string[]):Promise<T[]> {
 const out:T[]=[];for(let i=0;i<ids.length;i+=100) out.push(...await rows<T>(client,table,columns,q=>q.in(key,ids.slice(i,i+100))));
 if(out.length>10000)throw Error("Related data exceeds the bounded workspace read.");return out;
}
// Same existing fee derivation and historical-attempt eligibility. Building scope is
// applied to the first database read, before loading any terms/invoices/payments.
export async function readBuildingFees(client:SupabaseClient,input:DashboardInput) {
 const sales=await rows<DashboardInput["sales"][number]>(client,"unit_sale_attempts","id,building_id,unit_id,is_active,workflow_status,redacted_at",q=>q.eq("building_id",input.buildingId).is("redacted_at",null));
 const ids=sales.map(s=>s.id);
 const [terms,invoices]=await Promise.all([
 related<DashboardInput["terms"][number]>(client,"unit_sale_terms","id,sale_attempt_id,is_current,version_number,contract_price,exchange_agent_fee_percent,completion_agent_fee_percent,vat_rate","sale_attempt_id",ids),
 related<DashboardInput["invoices"][number]>(client,"unit_sale_invoices","id,sale_attempt_id,invoice_type,status,fee_milestone,gross_amount,expected_payable_amount,reservation_fee_deduction,agent_contribution_deduction,approved_at,created_at","sale_attempt_id",ids)
 ]);
 const payments=await related<DashboardInput["payments"][number]>(client,"unit_sale_invoice_payments","id,invoice_id,payment_source,payer_type,amount,paid_at,voided_at","invoice_id",invoices.map(i=>i.id));
 const facts={...input,sales,terms,invoices,payments};
 return {sales,terms,invoices,payments,portfolio:feePortfolioFromSales(facts)};
}
