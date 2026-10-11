"use client";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { deriveAgentFeePortfolioRow, type AgentFeePortfolioInvoice, type AgentFeePortfolioRow } from "@/lib/sales/agent-fees-portfolio";
import type { AgentFeePayment } from "@/lib/sales/agent-fees";
import { isSalesAccessError, salesLoadErrorMessage } from "@/lib/sales/load-errors";

type RpcRow = {
  sale_attempt_id:string;building_id:string;building_name:string;unit_id:string;unit_number:string;
  unit_sale_status:string;workflow_status:string;sales_agent_organisation_id:string|null;sales_agent_name:string|null;
  contract_price:number|null;exchange_fee_percent:number|null;completion_fee_percent:number|null;vat_rate:number|null;
  exchange_invoice:AgentFeePortfolioInvoice|null;completion_invoice:AgentFeePortfolioInvoice|null;
  exchange_active_payments:AgentFeePayment[];completion_active_payments:AgentFeePayment[];
};
export async function queryAgentFeePortfolio(requesterId:string) {
  const {data,error,count}=await createSupabaseBrowserClient().rpc("get_agent_fee_portfolio",{p_requester_id:requesterId},{count:"exact"});
  if(error)throw error;
  if(!Array.isArray(data)||count===null||count!==data.length)throw new Error("Agent Fees data is incomplete. Retry before treating the workload as clear.");
  const ids=new Set<string>();
  return (data as RpcRow[]).map(row=>{
    // Missing fee terms/payments cannot confidently be classified as zero.
    if(!row.sale_attempt_id||ids.has(row.sale_attempt_id)||!row.unit_id||!row.building_id||
      [row.contract_price,row.exchange_fee_percent,row.completion_fee_percent,row.vat_rate].some(n=>n===null||n===undefined||!Number.isFinite(Number(n)))||
      row.exchange_invoice===undefined||row.completion_invoice===undefined||
      !Array.isArray(row.exchange_active_payments)||!Array.isArray(row.completion_active_payments))
      throw new Error("Agent Fees data is incomplete. A sale is missing current fee terms or payment inputs.");
    ids.add(row.sale_attempt_id);
    return deriveAgentFeePortfolioRow({
      saleAttemptId:row.sale_attempt_id,buildingId:row.building_id,buildingName:row.building_name,unitId:row.unit_id,unitNumber:row.unit_number,
      unitSaleStatus:row.unit_sale_status,workflowStatus:row.workflow_status,agentOrganisationId:row.sales_agent_organisation_id,agentName:row.sales_agent_name,
      salePrice:row.contract_price,exchangeFeePercent:row.exchange_fee_percent,completionFeePercent:row.completion_fee_percent,vatRate:row.vat_rate,
      exchangeInvoice:row.exchange_invoice,completionInvoice:row.completion_invoice,exchangePayments:row.exchange_active_payments,completionPayments:row.completion_active_payments,
    });
  });
}
type State={scope:string;rows:AgentFeePortfolioRow[]|null;error:string;loading:boolean;refreshKey:unknown;retry:number};
/** Owned by the retained Sales workspace, so file visits do not re-fetch Fees. */
export function useAgentFeePortfolio(requesterId:string,scope:string,enabled:boolean,refreshKey:unknown) {
  const [retry,setRetry]=useState(0);
  const [state,setState]=useState<State|null>(null);
  const needsLoad=enabled && (!state||state.scope!==scope||state.refreshKey!==refreshKey||state.retry!==retry);
  useEffect(()=>{
    if(!enabled)return;
    let cancelled=false;
    // Defer state work until after the render; a key mismatch already presents
    // loading synchronously and withholds snapshots from a different scope.
    void Promise.resolve().then(()=>{
      if(cancelled)return;
      setState(old=>({scope,rows:old?.scope===scope?old.rows:null,error:"",loading:true,refreshKey,retry}));
      return queryAgentFeePortfolio(requesterId).then(rows=>{
        if(!cancelled)setState({scope,rows,error:"",loading:false,refreshKey,retry});
      }).catch(error=>{
        const denied=isSalesAccessError(error)||/Only developers or admins can view|cannot view the Agent Fees portfolio/i.test(salesLoadErrorMessage(error));
        if(!cancelled)setState(old=>({scope,rows:denied?null:old?.scope===scope?old.rows:null,error:salesLoadErrorMessage(error),loading:false,refreshKey,retry}));
      });
    });
    return ()=>{cancelled=true;};
    // The parent keeps enabled true during fee-record visits. Returning does
    // not change these dependencies; scope or explicit refresh does.
  },[requesterId,scope,refreshKey,retry,enabled]);
  return {rows:state?.scope===scope?state.rows:null,error:state?.scope===scope?state.error:"",loading:needsLoad||Boolean(state?.scope===scope&&state.loading),retry:()=>setRetry(n=>n+1)};
}
