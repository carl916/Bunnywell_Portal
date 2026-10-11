"use client";
import { useEffect, useMemo, type MouseEvent } from "react";
import { formatGbp } from "@/lib/sales/currency";
import { FEE_CATEGORIES, INITIAL_FEE_FILTERS, feeRecordUrl, feeScopeRows, matchingFeeActions, readFeeFilters, selectFeeCategory, selectFeeRows, summariseFeeCategories, writeFeeFilters, type FeeFilters } from "@/lib/sales/fee-workspace";
import type { AgentFeePortfolioInvoiceState } from "@/lib/sales/agent-fees-portfolio";
import type { useAgentFeePortfolio } from "./useAgentFeePortfolio";
import { useSalesOverviewNavigation } from "./useSalesOverviewNavigation";
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
  const navigation=useSalesOverviewNavigation(true,Boolean(portfolio.rows),"");
  const filters=useMemo(()=>readFeeFilters(navigation.search),[navigation.search]);
  const {rows,error,loading}=portfolio;
  const scopeRows=useMemo(()=>feeScopeRows(rows??[],buildingContextId,filters.agent),[rows,buildingContextId,filters.agent]);
  const summary=useMemo(()=>summariseFeeCategories(scopeRows),[scopeRows]);
  const selected=useMemo(()=>selectFeeRows(scopeRows,filters,unitOrder),[scopeRows,filters,unitOrder]);
  const agents=useMemo(()=>[...new Map(feeScopeRows(rows??[],buildingContextId,"").map(r=>[r.agentOrganisationId??"unassigned",r.agentName])).entries()].sort((a,b)=>a[1].localeCompare(b[1])),[rows,buildingContextId]);
  const page=Math.min(filters.page,Math.max(1,Math.ceil(selected.length/SALES_PAGE_SIZE)));
  function update(next:FeeFilters) {
    const params=new URLSearchParams(window.location.search);writeFeeFilters(params,next);
    window.history.replaceState({...window.history.state,salesScroll:undefined},"",`/?${params}#fee-results`);
    window.dispatchEvent(new Event("sales-overview-navigation"));
  }
  useEffect(()=>{if(rows&&page!==filters.page)update({...filters,page});},[rows,page,filters]);
  const change=(patch:Partial<FeeFilters>)=>update({...filters,...patch,page:patch.page??1});
  function open(event:MouseEvent<HTMLAnchorElement>,href:string,unit:string) {
    if(event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();onOpenSale(href,unit);
  }
  return <section className={`panel ${styles.fees}`} id="fee-results" aria-labelledby="fee-heading" aria-busy={loading&&!rows}>
    <header className={styles.header}><div><h2 id="fee-heading">Agent Fees</h2><p>Scope: {buildingContextId?buildingContextName:"All buildings"}{filters.agent?` · ${agents.find(([id])=>id===filters.agent)?.[1]??"Selected agent"}`:" · All agents"}</p></div>{rows&&loading&&<span role="status">Refreshing…</span>}</header>
    <div className={styles.views} role="group" aria-label="Fee responsibility">
      {(["ours","others","all"] as const).map(work=><button key={work} type="button" aria-pressed={filters.work===work} onClick={()=>change({work,category:""})}>{({ours:"Our actions",others:"Waiting on others",all:"All records"})[work]}</button>)}
    </div>
    {error&&<div className={styles.error} role="alert"><strong>Agent Fees could not be loaded completely.</strong><p>{error}</p>{rows&&<p>Showing the last loaded position. Review controls remain disabled until refresh succeeds.</p>}<button type="button" className="secondary" disabled={loading} onClick={portfolio.retry}>Retry Agent Fees</button></div>}
    <div className={styles.categories} aria-label="Fee categories">
      {Object.entries(FEE_CATEGORIES).map(([key,label])=>{
        const category=key as keyof typeof FEE_CATEGORIES,s=summary.categories[category];
        return <button key={key} type="button" aria-pressed={filters.category===key} onClick={()=>update(selectFeeCategory(filters,filters.category===key?"":category))}>
          <strong>{label}</strong><span className={styles.categoryValue}>{!rows?<span className={styles.skeleton} aria-label="Count unavailable"/>:category==="payment-position"?formatGbp(s.amount):`${s.tasks} ${category==="invoice-submission"?"required submissions/corrections":"invoices"}`}</span>
          <span>{rows?`${s.sales} ${s.sales===1?"sale":"sales"} · `:""}{category==="invoice-submission"?"Agent team / unallocated":"Developer team"}</span>
          {rows&&s.unallocated>0&&<span>{s.unallocated} unallocated {s.unallocated===1?"milestone":"milestones"}</span>}
        </button>;
      })}
    </div>
    <p className={styles.scopeNote}>Category totals cover the selected building and agent, across both milestones. Search, milestone, view and page affect only the table. Sales can appear in more than one category.</p>
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
          <td><p>{first?first.label:"View recorded invoice position"}{actions.length>1?` · ${actions.length-1} more action`:""}</p>{owners.length>0&&<small>Action with {owners.join(" / ")}</small>}</td>
          <td>{error?<button className={styles.review} type="button" disabled>Review unavailable</button>:<a className={styles.review} href={href} onClick={event=>open(event,href,row.unitId)}>{actions.length>1?`Review ${actions.length} actions`:first?"Review action":"Open fee record"}</a>}</td></tr>;
      })}</tbody></table>
    </SalesTableScroll>
    {rows&&!selected.length&&<p className={styles.empty}>{error?"Current workload is unavailable. Retry before treating this view as clear.":"No sales match this view. Other fee categories or records may still require attention."} <button className="secondary" type="button" onClick={()=>update({...INITIAL_FEE_FILTERS,work:"all"})}>Show all records</button></p>}
    {rows&&<SalesPagination total={selected.length} currentPage={page} onPageChange={page=>change({page})}/>}
  </section>;
}
