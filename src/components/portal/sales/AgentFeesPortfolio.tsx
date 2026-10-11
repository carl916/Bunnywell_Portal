"use client";
import { useEffect, useMemo, type MouseEvent } from "react";
import { formatGbp } from "@/lib/sales/currency";
import { FEE_VIEWS, INITIAL_FEE_FILTERS, feeRecordUrl, feeScopeRows, matchingFeeActions, readFeeFilters, selectFeeView, selectFeeRows, summariseFeeCategories, writeFeeFilters, type FeeFilters, type FeeView } from "@/lib/sales/fee-workspace";
import type { AgentFeePortfolioInvoiceState } from "@/lib/sales/agent-fees-portfolio";
import type { useAgentFeePortfolio } from "./useAgentFeePortfolio";
import { replaceSalesListUrl, useSalesOverviewNavigation } from "./useSalesOverviewNavigation";
import { SALES_PAGE_SIZE, SalesPagination } from "./SalesPagination";
import { SalesTableScroll } from "./SalesTableScroll";
import styles from "./AgentFeesPortfolio.module.css";

function invoiceStatusLabel(state:AgentFeePortfolioInvoiceState) {
  if(state.kind==="paid") return "Paid";
  if(state.kind==="approved_unpaid"||state.kind==="part_paid")return `${state.kind==="part_paid"?"Part paid":"Approved"} · ${formatGbp(state.outstandingBalance)} remaining`;
  return ({not_submitted:state.needsAction?"Submission required":"Not submitted",not_due:"Not due",invoice_required:"Submission required",awaiting_approval:"Awaiting approval",rejected:"Correction required"})[state.kind];
}
export function AgentFeesPortfolio({portfolio,buildingContextId,buildingContextName,unitOrder,onOpenSale}:{
  portfolio:ReturnType<typeof useAgentFeePortfolio>;buildingContextId:string;buildingContextName:string;unitOrder:Map<string,number>;
  onOpenSale:(href:string,unitId:string)=>void;
}) {
  const navigation=useSalesOverviewNavigation(true,Boolean(portfolio.rows),"","fee-results");
  const filters=useMemo(()=>readFeeFilters(navigation.search),[navigation.search]);
  const {rows,error,loading}=portfolio;
  const scopeRows=useMemo(()=>feeScopeRows(rows??[],buildingContextId,filters.agent,filters.assignedOnly),[rows,buildingContextId,filters.agent,filters.assignedOnly]);
  const summary=useMemo(()=>summariseFeeCategories(scopeRows),[scopeRows]);
  const selected=useMemo(()=>selectFeeRows(scopeRows,filters,unitOrder),[scopeRows,filters,unitOrder]);
  const agents=useMemo(()=>[...new Map(feeScopeRows(rows??[],buildingContextId,"").map(r=>[r.agentOrganisationId??"unassigned",r.agentName])).entries()].sort((a,b)=>a[1].localeCompare(b[1])),[rows,buildingContextId]);
  const page=Math.min(filters.page,Math.max(1,Math.ceil(selected.length/SALES_PAGE_SIZE)));
  function update(next:FeeFilters,intent:"filter"|"page"|"clamp"="filter") {
    const params=new URLSearchParams(window.location.search);writeFeeFilters(params,next);
    replaceSalesListUrl(`/?${params}${window.location.hash}`,intent);
  }
  useEffect(()=>{if(rows&&page!==filters.page)update({...filters,page},"clamp");},[rows,page,filters]);
  const change=(patch:Partial<FeeFilters>)=>update({...filters,...patch,page:patch.page??1});
  function open(event:MouseEvent<HTMLAnchorElement>,href:string,unit:string) {
    if(event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();onOpenSale(href,unit);
  }
  return <section className={`panel ${styles.fees}`} id="fee-results" aria-labelledby="fee-heading" aria-busy={loading&&!rows}>
    <header className={styles.header}><div><h2 id="fee-heading">Agent Fees</h2><p>Scope: {buildingContextId?buildingContextName:"All buildings"}{filters.agent?` · ${agents.find(([id])=>id===filters.agent)?.[1]??"Selected agent"}`:" · All agents"}</p></div>{rows&&loading&&<span role="status">Refreshing…</span>}</header>
    {error&&<div className={styles.error} role="alert"><strong>Agent Fees could not be loaded completely.</strong><p>{error}</p>{rows&&<p>Showing the last loaded position. Review controls remain disabled until refresh succeeds.</p>}<button type="button" className="secondary" disabled={loading} onClick={portfolio.retry}>Retry Agent Fees</button></div>}
    <div className={styles.views} role="group" aria-label="Fee work view">
      {Object.entries(FEE_VIEWS).map(([key,label])=>{
        const view=key as FeeView,s=view==="ours"||view==="all"?null:summary.categories[view];
        const sales=s?.sales??(view==="ours"?summary.ourSales:summary.allSales);
        return <button key={key} type="button" aria-label={label} aria-describedby={`fee-summary-${key}`} aria-pressed={filters.view===view} onClick={()=>{if(filters.view!==view)update(selectFeeView(filters,view));}}>
          <strong>{label}</strong><span id={`fee-summary-${key}`} className={styles.summary}>
            {!rows?<span className={styles.skeleton} aria-label="Count unavailable"/>:<>
              <span className={styles.categoryValue}>{view==="payment-position"?formatGbp(s!.amount):`${sales} ${sales===1?"sale":"sales"}`}</span>
              <span>{view==="payment-position"?`${sales} ${sales===1?"sale":"sales"} · ${s!.tasks} invoices`:view==="invoice-review"?`${s!.tasks} invoices`:view==="invoice-submission"?`${s!.tasks} milestones · ${s!.unallocated} unallocated`:view==="ours"?"Approval or payment review":"Including settled positions"}</span>
            </>}
          </span>
        </button>;
      })}
    </div>
    {filters.assignedOnly&&<div className={styles.legacyScope}><span>Assigned agents only · applies to all views and totals until removed.</span><button type="button" onClick={()=>change({assignedOnly:false})}>Remove assigned-agent scope</button></div>}
    <div className={styles.scopeNote}><span>Totals: building + agent{filters.assignedOnly?" · assigned agents only":""}.</span><details><summary aria-label="About fee totals">About totals</summary><p>Totals cover both milestones in this scope. Search, milestone and page refine only the table. Views overlap; do not add their sale counts together.</p></details></div>
    {rows&&<p className={styles.future}>Future uninvoiced completion fees: <strong>{formatGbp(summary.futureNet)} net</strong>. These are separate from approved balances.</p>}
    <div className={styles.controls}>
      <label>Agent<select value={filters.agent} onChange={e=>change({agent:e.target.value})}><option value="">All agents</option>{agents.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
      <label>Milestone<select value={filters.milestone} onChange={e=>change({milestone:e.target.value as FeeFilters["milestone"]})}><option value="all">All milestones</option><option value="exchange">Exchange</option><option value="completion">Completion</option></select></label>
      <label>Sort<select value={filters.sort} onChange={e=>change({sort:e.target.value as FeeFilters["sort"]})}><option value="work">Work priority</option><option value="unit">Unit order</option></select></label>
      <label>Search fees<input type="search" value={filters.search} maxLength={200} onChange={e=>change({search:e.target.value})} placeholder="Unit, building or agent"/></label>
      <button className="secondary" type="button" onClick={()=>update(INITIAL_FEE_FILTERS)}>Reset filters</button>
    </div>
    <p role="status" className={styles.resultCount}>{rows?`${selected.length} ${selected.length===1?"sale":"sales"} in this filtered view${error?" · last loaded results":""}`:error?"Fee counts unavailable":"Loading Agent Fees…"}</p>
    <p className={styles.scrollHint}>Scroll the table sideways for invoice positions and review controls.</p>
    <SalesTableScroll className={styles.tableScroll} label="Agent fees">
      <table><thead><tr><th>Unit / building</th><th>Agent</th><th>Exchange invoice</th><th>Completion invoice</th><th>Next step</th><th>Review</th></tr></thead>
      <tbody>{!rows&&!error?Array.from({length:5},(_,i)=><tr key={i} aria-hidden="true">{Array.from({length:6},(_,n)=><td key={n}><span className={styles.skeleton}/></td>)}</tr>):rows&&selected.slice((page-1)*SALES_PAGE_SIZE,page*SALES_PAGE_SIZE).map(row=>{
        const actions=matchingFeeActions(row,filters),first=actions[0],href=feeRecordUrl(row,filters,navigation.search);
        const owners=[...new Set(actions.map(a=>a.owner==="developer"?"Developer team":a.owner==="agent"?row.agentName:"Unallocated"))];
        return <tr key={row.saleAttemptId}><td><strong>Unit {row.unitNumber}</strong><small>{row.buildingName}</small>{row.noLongerForSale&&<small>No longer for sale</small>}</td><td>{row.agentName}</td>
          <td>{invoiceStatusLabel(row.exchange)}</td><td>{invoiceStatusLabel(row.completion)}</td>
          <td><p>{first?first.label:"View recorded invoice position"}{actions.length>1?` · ${actions.length-1} more action`:""}</p>{owners.length>0&&!(filters.view!=="all"&&filters.view!=="invoice-submission"&&actions.every(a=>a.owner==="developer"))&&<small>Action with {owners.join(" / ")}</small>}</td>
          <td>{error?<button className={styles.review} type="button" disabled>Review unavailable</button>:<a className={styles.review} href={href} onClick={event=>open(event,href,row.unitId)}>{actions.length>1?`Review ${actions.length} actions`:first?"Review action":"Open fee record"}</a>}</td></tr>;
      })}</tbody></table>
    </SalesTableScroll>
    {rows&&!selected.length&&<p className={styles.empty}>{error?"Current workload is unavailable. Retry before treating this view as clear.":({ours:"No approval or approved payment work matches these refinements.","invoice-review":"No invoices awaiting approval match these refinements.","payment-position":"No positive approved unpaid balances match these refinements.","invoice-submission":"No required invoice submissions or corrections match these refinements.",all:"No fee records match these refinements."})[filters.view]}</p>}
    {rows&&<SalesPagination total={selected.length} currentPage={page} onPageChange={page=>update({...filters,page},"page")}/>}
  </section>;
}
