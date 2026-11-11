import { deriveDashboard } from "../../dashboard/model";
import type { DashboardInput, WorkItem } from "../../dashboard/types";
import { matchesWorkTeam, isUnallocatedWork, isWorkObservation } from "../../dashboard/work-classification";
import { deriveSalesRegister } from "../../sales/register";
import { buildingSalesResponsibility } from "../../sales/responsibility";
import { canPerformSalesAction, isSalesInternalRole } from "../../sales/permissions";
import { feePortfolioFromSales } from "../../sales/fee-portfolio-data";
import { feeActions } from "../../sales/fee-workspace";
import { calculateMilestoneFee } from "../../sales/agent-fees";
import { sortUnitsByBuildingFloorOrder, isSalesRouteUnit } from "../../units/commercial-allocation";
import { contractVersion, ContractError, roles, validId, type Scope, type Building, type Workspace, type Action, type Counts, type SaleRow } from "./contracts";

export type Access = { identity: string; role: string; organisationId: string | null; accessRevision: string; active: boolean; buildingIds: string[] };
// Access is supplied by a trusted adapter, never accepted as authentication from a browser.
// Stage 1 supplies named offline identities; Stage 2 uses the approved local authenticated adapter. No remote adapter exists.
export function scopeFor(access: Access, buildingId: string): Scope {
  if (!access.active || !roles.includes(access.role as Scope["role"]) || !validId(buildingId) || !access.buildingIds.includes(buildingId)) throw new ContractError("Building unavailable for this account.");
  return { identity:access.identity,role:access.role as Scope["role"],organisationId:access.organisationId,accessRevision:access.accessRevision,buildingId };
}
export function summarise(rows: SaleRow[], complete: boolean): Counts {
  const stages: Record<string,number> = {};
  for (const row of rows) stages[row.stage] = (stages[row.stage] ?? 0)+1;
  const all = [...new Map(rows.flatMap(r=>r.actions).map(a=>[a.id,a])).values()];
  const bucket = (queue: Action["queue"]) => {
    const matches=all.filter(a=>a.queue===queue);
    return { actions:matches.length,sales:new Set(matches.map(a=>a.destination.saleId)).size };
  };
  return { units:rows.length,stages,complete,ours:complete?bucket("ours"):null,others:complete?bucket("others"):null,
    unallocated:complete?bucket("unallocated"):null,distinctSales:complete?new Set(all.map(a=>a.destination.saleId)).size:null };
}
function wording(item: WorkItem) {
  if (item.ours) return item.action;
  if (item.kind.startsWith("replace_")) return item.kind.endsWith("draft_statement_of_account") ? "Awaiting revised statement of account" : "Awaiting revised completion statement";
  if (item.kind.startsWith("review_")) return item.kind.endsWith("draft_statement_of_account") ? "Awaiting statement of account approval" : "Awaiting completion statement approval";
  if (item.kind==="reservation_review") return "Awaiting reservation approval";
  if (item.kind==="reservation_correct") return "Awaiting corrected reservation";
  if (item.kind.startsWith("fee_")) return item.kind.includes("awaiting_approval") ? "Awaiting agent invoice review" : item.kind.includes("paid") ? "Awaiting fee payment update" : "Awaiting "+(item.kind.includes("completion")?"completion":"exchange")+" agent invoice";
  return item.action;
}
export function projectWorkspace(access: Access, building: Building, input: DashboardInput, buyers: Record<string,string>, fixtureOnly = true): Workspace {
  const scope=scopeFor(access,building.id);
  if (input.buildingId!==building.id || input.viewer.id!==scope.identity || input.viewer.role!==scope.role || input.viewer.organisation_id!==scope.organisationId ||
      input.buildings.length!==1 || input.buildings[0].id!==building.id || input.units.some(u=>u.building_id!==building.id) || input.sales.some(s=>s.building_id!==building.id))
    throw new ContractError("Scoped input contains another building or identity.");
  const unitIds=new Set(input.units.map(u=>u.id)), saleIds=new Set(input.sales.map(s=>s.id));
  const childFacts=[...input.documents,...input.authorities,...input.saleEvents,...input.deposits,...input.depositSources,...(input.furtherDeposits??[]),...input.invoices,...input.terms];
  const invoiceIds=new Set(input.invoices.map(i=>i.id));
  if (input.sales.some(s=>!unitIds.has(s.unit_id)) || childFacts.some(d=>!saleIds.has(d.sale_attempt_id)) ||
      input.payments.some(p=>!invoiceIds.has(p.invoice_id)) || input.floors.some(f=>f.building_id!==building.id) ||
      input.buildingOrganisations.some(o=>o.building_id!==building.id) || input.feePortfolio?.length ||
      input.snags.length || input.handovers.length || input.tenancies.length || input.arrears.length || input.rentalImports.length || input.accessRequests.length)
    throw new ContractError("Related facts outside the scoped Sales input.");
  const dashboard=deriveDashboard(input);
  const feeAllowed=isSalesInternalRole(scope.role)||scope.role==="sales_agent";
  const sources=dashboard.sources.filter(s=>["sales","legal","appointments","fees"].includes(s.key)).map(s=>({key:s.key,state:s.key==="fees"&&!feeAllowed?"not_permitted" as const:s.state}));
  const required=["sales","legal","appointments",...(feeAllowed?["fees"]:[])];
  const complete=required.every(key=>sources.some(s=>s.key===key&&s.state==="ready"));
  // Retain the current population and reconciliation behaviour; no historical fee-only attempts.
  const register=deriveSalesRegister(input,dashboard);
  let items=dashboard.items.filter(i=>i.module==="sales"&&!i.kind.startsWith("fee_")&&!isWorkObservation(i));
  // The existing portfolio RPC is deliberately not called. Offline scoped facts reuse its pure derivation.
  // Agent projections use only permitted per-sale facts; conveyancers receive no fee facts.
  if (complete && feeAllowed) {
    const feeRows=feePortfolioFromSales(input);
    for(const row of feeRows) for(const fee of feeActions(row)) {
      const submit=fee.category==="invoice-submission";
      const party=submit?buildingSalesResponsibility(input.buildings[0],"sales_agent",input.organisations):{kind:"developer" as const,organisationId:null,label:"Developer team"};
      const ours=party.kind==="developer"?isSalesInternalRole(scope.role):party.organisationId===scope.organisationId&&party.kind===scope.role;
      // This is a display of existing capability, not an action endpoint or an access grant.
      const capability=canPerformSalesAction(scope.role,submit?"submit_agent_invoice":fee.category==="invoice-review"?"approve_agent_invoice":"record_agent_fee_payment");
      items.push({id:`sale:${row.saleAttemptId}:fee_${fee.state.milestone}_${fee.state.kind}:${fee.state.invoiceId??"current"}`,
        recordKey:"sale:"+row.saleAttemptId,module:"sales",source:"Agent Fees",kind:`fee_${fee.state.milestone}_${fee.state.kind}`,
        buildingId:row.buildingId,unitId:row.unitId,reference:row.unitNumber,position:"",action:fee.label,responsibility:party,ours,canAct:capability,
        waiting:{since:fee.state.submittedAt??null,precision:"instant",basis:"Invoice",fallback:false},deadline:null,urgent:false,cycleId:fee.state.invoiceId??null,context:null,countingUnit:"invoice",
        destination:{screen:"sales",buildingId:row.buildingId,unitId:row.unitId,saleId:row.saleAttemptId,section:"financials",anchor:fee.state.milestone+"-fee"}});
    }
  }
  if (!complete) items=[];
  const ordered=sortUnitsByBuildingFloorOrder(input.units.filter(isSalesRouteUnit),input.floors,input.buildings);
  let reconciliationComplete=true;
  const rows: SaleRow[]=ordered.map(unit=>{
    const active=input.sales.filter(s=>s.unit_id===unit.id&&s.is_active&&!s.redacted_at&&!["fallen_through","superseded","failed","withdrawn"].includes(s.workflow_status));
    if(active.length>1)reconciliationComplete=false;
    const sale=active.length===1?active[0]:null;
    const current=register.rows.find(r=>r.unitId===unit.id)!;
    const selected=sale?items.filter(i=>i.recordKey==="sale:"+sale.id):[];
    const unique=[...new Map(selected.map(i=>[i.id,i])).values()];
    const actions:Action[]=unique.filter(i=>matchesWorkTeam(i,"ours")||matchesWorkTeam(i,"others")||isUnallocatedWork(i)).map(i=>({
      id:i.id,kind:i.kind,title:wording(i),party:{kind:i.responsibility.kind,organisationId:i.responsibility.organisationId,label:i.responsibility.label,allocation:i.responsibility.allocation},
      queue:matchesWorkTeam(i,"ours")?"ours":matchesWorkTeam(i,"others")?"others":"unallocated",
      existingCapability:i.canAct,businessEnabled:false,countingUnit:i.countingUnit,deadline:i.deadline,urgent:i.urgent,
      destination:{buildingId:building.id,unitId:unit.id,saleId:sale!.id,section:i.destination?.section??"progression",anchor:i.destination?.anchor??"",...(i.destination?.versionId?{versionId:i.destination.versionId}:{})}
    }));
    // Existing register dependency order first; fee helper order follows. Prefer our work for prominence only.
    const rank=(a:Action)=>{const n=current.actions.findIndex(v=>v.id===a.id);return n<0?100:n;};
    actions.sort((a,b)=>Number(b.queue==="ours")-Number(a.queue==="ours")||rank(a)-rank(b)||Number(b.urgent)-Number(a.urgent)||(a.deadline?.at??"z").localeCompare(b.deadline?.at??"z")||a.id.localeCompare(b.id));
    const agent=buildingSalesResponsibility(input.buildings[0],"sales_agent",input.organisations);
    const draft=sale?.workflow_status==="draft";
    const fee=actions.find(a=>/^fee_(exchange|completion)_not_submitted$/.test(a.kind));
    const oursAgent=scope.role==="sales_agent"&&agent.organisationId===scope.organisationId;
    const ownPrimary=actions.find(a=>a.queue==="ours"), focus=ownPrimary??fee??actions[0];
    const feePreview=Boolean(fee&&(!ownPrimary||ownPrimary===fee));
    const heading=draft?(oursAgent?"Prepare the reservation":"Awaiting reservation submission"):feePreview?(oursAgent?"Prepare the agent invoice":"Awaiting agent invoice"):focus?.kind.startsWith("replace_")&&focus.queue==="ours"?"Resolve the query":focus?.title??"Sale information";
    const preview:SaleRow["preview"]={heading,state:draft?"Draft - not submitted":fee?"Invoice not yet submitted":sale?.workflow_status??"No single active sale",
      responsibleTeam:draft?agent.label:focus?.party.label??agent.label,mode:draft?!oursAgent?"waiting":"read-only":focus&&focus.queue!=="ours"?"waiting":"read-only",
      onBehalf:(draft||feePreview)&&!oursAgent&&canPerformSalesAction(scope.role,draft?"submit_reservation":"submit_agent_invoice")?
        {label:draft?"Submit reservation on behalf of agent":"Submit invoice on behalf of agent",existingRoleAllows:true,enabled:false}:null};
    const terms=input.terms.find(t=>t.sale_attempt_id===sale?.id&&t.is_current);
    if (feeAllowed&&feePreview&&fee&&terms&&terms.contract_price!=null) preview.expectedInvoiceGross=calculateMilestoneFee({salePrice:terms.contract_price,feePercent:(fee.kind.includes("completion")?terms.completion_agent_fee_percent:terms.exchange_agent_fee_percent)??0,vatRate:terms.vat_rate??20}).grossAmount;
    return {unitId:unit.id,unitNumber:unit.unit_number,buildingId:building.id,buildingName:building.name,floor:unit.floor??"",
      saleId:sale?.id??null,buyerLabel:sale?buyers[sale.id]??"Buyer details unavailable":"",stage:unit.sale_status,actions,primaryActionId:actions[0]?.id??null,
      warning:[current.warning,!complete?"Actions unavailable: required data is incomplete.":null].filter(Boolean).join(" ")||null,preview};
  });
  return {contract:contractVersion,scope,building:{id:building.id,name:building.name,address:building.address},asOf:new Date(input.now).toISOString(),fixtureOnly,
    population:feeAllowed?"Current-sale legal, reservation and permitted fee actions":"Current-sale legal and reservation actions; fees outside this role contract",
    sources,counts:summarise(rows,complete&&reconciliationComplete),rows};
}


