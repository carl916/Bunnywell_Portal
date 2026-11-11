"use client";
import type { MouseEvent, ReactNode } from "react";
import { ArrowUpRight, Building2, Search } from "lucide-react";
import { accessibleBuildings, prototypeUrl, saleStages, units, unitScenario, type NavigationState, type FixtureUnit } from "@/lib/experiments/sales-workspace/model";
import { queues, taskPresentation } from "@/lib/experiments/sales-workspace/presentation";
import { canViewDeveloperCommercials } from "@/lib/sales/permissions";
import { Badge, Heading, KeyValues, money } from "./PrototypeUI";
import s from "./Workspace.module.css";
export type Navigate = (change: Record<string, string | null>, options?: { replace?: boolean; scroll?: number; keepFocus?: boolean }) => void;
export function LocalLink({ href, onNavigate, children, className, current, title }: { href: string; onNavigate: () => void; children: ReactNode; className?: string; current?: boolean; title?: string }) {
  function click(e: MouseEvent<HTMLAnchorElement>) {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    e.preventDefault(); onNavigate();
  }
  return <a href={href} onClick={click} className={className} aria-current={current ? "page" : undefined} title={title}>{children}</a>;
}
export function recordChange(unit: FixtureUnit) {
  return { building: unit.building_id, unit: unit.id, view: "sale", scenario: null, section: unitScenario(unit).section, task: null, q: null, stage: null, queue: null, page: null };
}
type Props = { state: NavigationState; search: string; navigate: Navigate };
export function BuildingChooser({ state, onSelect, switching = false }: { state: NavigationState; onSelect: (id: string) => void; switching?: boolean }) {
  return <>{switching ? <div className={s.pageHeading}><div><h3>Change building</h3><p>Open the sales worklist in another building.</p></div></div> : <Heading eyebrow="Your buildings" title="Choose your building" description="Choose where you’re working today. Each building has its own sales workspace." />}
    <div className={s.buildingCards}>{accessibleBuildings(state.profile).map((b, i) => <button key={b.id} className={s.buildingCard} onClick={() => onSelect(b.id)} aria-label={"Open " + b.name}>
      <span className={s.buildingCardIcon}><Building2 size={25} /></span><span className={s.buildingCardName}>{b.name}</span><span>{b.address}</span>
      <span className={s.buildingCardFoot}>{units.filter(u => u.building_id === b.id).length} sample units <ArrowUpRight size={18} /></span>
      {i === 0 && <small>Recently viewed · sample</small>}</button>)}</div>
    <p className={s.selectionNote}>Access and recent activity shown here are fictional. A building is selected only when you open it.</p>
  </>;
}
export function Worklist({ state, search, navigate }: Props) {
  const scoped = units.filter(u => u.building_id === state.building);
  const filtered = scoped.filter(u => (!state.stage || unitScenario(u).status === state.stage) && (!state.queue || taskPresentation(unitScenario(u), state.role).queue === state.queue) && (u.unit_number + " " + u.buyer).toLowerCase().includes(state.search.toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 6)), page = Math.min(state.page, pageCount);
  return <><Heading eyebrow="Building workspace / Sales" title="Sales worklist" description="Find a unit and open its current task." />
    <div className={s.stageCounts} aria-label="Sale stage counts">{["", ...saleStages].map(stage => <button key={stage} aria-pressed={state.stage === stage} onClick={() => navigate({ stage: stage || null, page: "1" }, { keepFocus: true })}>{stage || "All"} <strong>{stage ? scoped.filter(u => unitScenario(u).status === stage).length : scoped.length}</strong></button>)}</div>
    <section className={s.listCard}><div className={s.filters}><label><span>Search units or buyers</span><div className={s.searchInput}><Search size={17} /><input value={state.search} onChange={e => navigate({ q: e.target.value || null, page: "1" }, { replace: true, keepFocus: true })} placeholder="Search this building" /></div></label><label><span>Responsibility</span><select aria-label="Responsibility" value={state.queue} onChange={e => navigate({ queue: e.target.value || null, page: "1" }, { keepFocus: true })}><option value="">All responsibilities</option>{queues.map(queue => <option key={queue}>{queue}</option>)}</select></label></div>
      <table className={s.salesTable} aria-label="Building sales"><thead><tr><th>Unit / buyer</th><th>Floor</th><th>Sale status</th><th>Next action / responsibility</th></tr></thead><tbody>
        {filtered.slice((page - 1) * 6, page * 6).map(unit => {
          const task = taskPresentation(unitScenario(unit), state.role);
          const change = { ...recordChange(unit), section: task.section };
          return <tr key={unit.id}><td><LocalLink href={prototypeUrl(search, recordChange(unit))} onNavigate={() => navigate(recordChange(unit))}><strong>{unit.unit_number} <ArrowUpRight size={14} /></strong><span>{unit.buyer}</span></LocalLink></td><td>{unit.floor || "Unassigned"}</td><td><Badge tone={unitScenario(unit).status === "Completed" ? "success" : "neutral"}>{unitScenario(unit).status}</Badge></td><td className={s.nextAction}>
            <span className={s.queueLabel} data-ours={task.queue === "Our actions"}>{task.queue}</span>
            <LocalLink href={prototypeUrl(search, change)} onNavigate={() => navigate(change)}>{task.title} <ArrowUpRight size={13} /></LocalLink>
            <small>{task.responsibility}</small><small>{task.detail}</small>{task.deadline && <small className={s.deadline}>{task.deadline}</small>}
          </td></tr>;
        })}
      </tbody></table>{!filtered.length && <div className={s.emptyList} role="status"><p>No units match these filters.</p><button className={s.textButton} onClick={() => navigate({ q: null, stage: null, queue: null, page: "1" })}>Clear filters</button></div>}
      <div className={s.pagination}><span>{filtered.length} results · Page {page} of {pageCount}</span><button className={s.button} disabled={page === 1} onClick={() => navigate({ page: String(page - 1) }, { keepFocus: true })}>Previous</button><button className={s.button} disabled={page === pageCount} onClick={() => navigate({ page: String(page + 1) }, { keepFocus: true })}>Next</button></div>
    </section></>;
}
export function BuildingDashboard({ state, search, navigate }: Props) {
  const scoped = units.filter(u => u.building_id === state.building);
  const tasks = scoped.map(unit => ({ unit, task: taskPresentation(unitScenario(unit), state.role) }));
  return <><Heading eyebrow="Building workspace / Dashboard" title="Your building at a glance" description={state.role === "developer" ? "Reservations and documents that need your attention." : state.role === "sales_agent" ? "Prepare buyer details and invoices for this building." : "Review legal progression and outstanding document queries."} />
    <div className={s.dashboardGrid}><section className={s.card}>
      {["Our actions", "Waiting on others"].map(group => {
        const rows = tasks.filter(item => item.task.queue === group);
        return <section className={s.dashboardQueue} key={group} aria-label={group}><div className={s.cardHeading}><h2>{group}</h2><Badge>{rows.length} items</Badge></div>
          {rows.slice(0, 2).map(({ unit, task }) => <LocalLink key={unit.id} href={prototypeUrl(search, { ...recordChange(unit), section: task.section })} onNavigate={() => navigate({ ...recordChange(unit), section: task.section })} className={s.taskRow}><span className={s.unitTile}>{unit.unit_number}</span><span><strong>{task.title}</strong><small>{task.responsibility}{task.deadline ? " · " + task.deadline : ""}</small></span><ArrowUpRight size={17} /></LocalLink>)}
          {!rows.length && <p className={s.meta}>No items in this sample snapshot.</p>}
          {rows.length > 2 && <button className={s.textButton} onClick={() => navigate({ view: "worklist", unit: null, scenario: null, section: null, q: null, stage: null, queue: group, page: "1" })}>View all {rows.length} {group.toLowerCase()}</button>}
        </section>;
      })}
      <button className={s.primary} onClick={() => navigate({ view: "worklist", unit: null, section: null, scenario: null, queue: null, q: null, stage: null, page: "1" })}>Open sales worklist <ArrowUpRight size={16} /></button></section>
      <section className={s.card}><h2>Sales progression</h2><KeyValues items={saleStages.map(stage => [stage, scoped.filter(u => unitScenario(u).status === stage).length])} />
        <p className={s.meta}>Counts cover this building only.</p>{canViewDeveloperCommercials(state.role) && <details className={s.historyDisclosure}><summary>Financial summary</summary><KeyValues items={[["Agreed value · reserved onward", money(scoped.filter(u => unitScenario(u).status !== "For sale").length * 425000)]]} /><p>Each sample sale uses a £425,000 contract price. Open a unit’s Commercial Terms or Agent Fees for its detail.</p></details>}
      </section></div></>;
}
export function Portfolio({ state, onSelect }: { state: NavigationState; onSelect: (id: string) => void }) {
  return <><Heading eyebrow="Separate portfolio view" title="Portfolio overview" description="Cross-building reference. Select a building to enter its workspace." /><div className={s.buildingCards}>{accessibleBuildings(state.profile).map(b => <section key={b.id} className={s.card}><h2>{b.name}</h2><KeyValues items={saleStages.map(stage => [stage, units.filter(u => u.building_id === b.id && unitScenario(u).status === stage).length])} /><button className={s.button} onClick={() => onSelect(b.id)}>Open {b.name}</button></section>)}</div></>;
}

