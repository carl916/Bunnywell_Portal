"use client";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { type AgentFeePortfolioRow } from "@/lib/sales/agent-fees-portfolio";
import type { Building } from "@/lib/data/production";
import { readAgentFeePortfolio } from "@/lib/sales/fee-portfolio-data";
import { isSalesAccessError, salesLoadErrorMessage } from "@/lib/sales/load-errors";

export async function queryAgentFeePortfolio(requesterId: string, buildings: readonly Building[], organisations: readonly { id: string; name: string }[]) {
  return readAgentFeePortfolio(createSupabaseBrowserClient(), requesterId, buildings, organisations);
}
type State={scope:string;rows:AgentFeePortfolioRow[]|null;error:string;loading:boolean;refreshKey:unknown;retry:number};
/** Owned by the retained Sales workspace, so file visits do not re-fetch Fees. */
export function useAgentFeePortfolio(requesterId:string,identityScope:string,enabled:boolean,refreshKey:unknown,buildings:readonly Building[],organisations:readonly {id:string;name:string}[]) {
  const scope = JSON.stringify([identityScope, buildings.map(b => [b.id, b.sales_agent_organisation_id === undefined ? "unavailable" : b.sales_agent_organisation_id]).sort()]);
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
      return queryAgentFeePortfolio(requesterId,buildings,organisations).then(rows=>{
        if(!cancelled)setState({scope,rows,error:"",loading:false,refreshKey,retry});
      }).catch(error=>{
        const denied=isSalesAccessError(error)||/Only developers or admins can view|cannot view the Agent Fees portfolio/i.test(salesLoadErrorMessage(error));
        if(!cancelled)setState(old=>({scope,rows:denied?null:old?.scope===scope?old.rows:null,error:salesLoadErrorMessage(error),loading:false,refreshKey,retry}));
      });
    });
    return ()=>{cancelled=true;};
    // The parent keeps enabled true during fee-record visits. Returning does
    // not change these dependencies; scope or explicit refresh does.
  },[requesterId,scope,refreshKey,retry,enabled,buildings,organisations]);
  return {rows:state?.scope===scope?state.rows:null,error:state?.scope===scope?state.error:"",loading:needsLoad||Boolean(state?.scope===scope&&state.loading),retry:()=>setRetry(n=>n+1)};
}
