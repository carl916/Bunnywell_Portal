"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ArrowLeft, Building2, CheckCheck, ChevronRight, ClipboardList, Coins, FileCheck2, Handshake, KeyRound, LayoutDashboard, Menu, MessageSquare, PanelLeftClose, PanelLeftOpen, Sprout } from "lucide-react";
import { accessibleBuildings, buildings, prototypeUrl, readNavigation, roles, scenarios, sections, units, type NavigationState } from "@/lib/experiments/sales-workspace/model";
import { canPerformSalesAction } from "@/lib/sales/permissions";
import { AgentFeesWorkspace, CompletionWorkspace, ReservationWorkspace, SummaryWorkspace } from "./Workspaces";
import { Badge, DocumentPreview, Heading, KeyValues, Modal, Notice, ReadOnlyNote, type Preview } from "./PrototypeUI";
import { BuildingChooser, BuildingDashboard, LocalLink, Portfolio, Worklist, recordChange, type Navigate } from "./BuildingScreens";
import { FixtureDataState } from "./FixtureDataState";
import { SaleContextPanel, conversationFixture, type DiscussionState } from "./SaleContextPanel";
import s from "./Workspace.module.css";

const eventName = "sales-prototype-navigation";
function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener); window.addEventListener(eventName, listener);
  return () => { window.removeEventListener("popstate", listener); window.removeEventListener(eventName, listener); };
}
const snapshot = () => window.location.search;
const serverSnapshot = () => "";
const icons = { reservation: ClipboardList, exchange: Handshake, completion: FileCheck2, handover: KeyRound, deposits: Coins, "agent-fees": Coins, commercial: CheckCheck };
type DrawerState = "navigation" | "buildings" | "confirmation" | null;
type ReturnState = { q: string; stage: string; page: string; queue: string; scroll: number };
function storageKey(state: NavigationState, building = state.building) { return "bunnywell-prototype-list-v3:" + state.profile + ":" + state.role + ":" + building; }
function savedList(state: NavigationState, building: string): ReturnState {
  try {
    const data = JSON.parse(sessionStorage.getItem(storageKey(state, building)) || "{}");
    const validated = readNavigation(new URLSearchParams({ building, q: String(data.q ?? ""), stage: String(data.stage ?? ""), queue: String(data.queue ?? ""), page: String(data.page ?? 1) }).toString());
    return { q: validated.search, queue: validated.queue, stage: validated.stage, page: String(validated.page), scroll: Math.max(0, Number(data.scroll) || 0) };
  } catch { return { q: "", stage: "", queue: "", page: "1", scroll: 0 }; }
}
function Navigation({ state, search, navigate, changeBuilding, backToList, collapsed = false }: { state: NavigationState; search: string; navigate: Navigate; changeBuilding: () => void; backToList: () => void; collapsed?: boolean }) {
  const building = buildings.find(b => b.id === state.building);
  const active = building && !["buildings", "portfolio", "unavailable"].includes(state.view);
  return <>
    <button className={s.workingSelector} onClick={changeBuilding} aria-label={active ? "Working in " + building.name + ". Change building" : "Choose building"} title={active ? "Working in " + building.name : "Choose building"}><Building2 size={21} /><span><small>{active ? "Working in" : "Your workspace"}</small><strong>{active ? building.name : "Choose building"}</strong></span><ChevronRight size={15} /></button>
    <nav className={s.moduleNav} aria-label="Building modules">
      {active && <><button className={state.view === "dashboard" ? s.moduleActive : ""} onClick={() => navigate({ view: "dashboard", unit: null, scenario: null, section: null, task: null })} aria-label="Dashboard"><LayoutDashboard size={18} /><span>Dashboard</span></button><button className={["worklist","sale"].includes(state.view) ? s.moduleActive : ""} onClick={backToList} aria-label="Sales"><Building2 size={18} /><span>Sales</span></button></>}
      <button onClick={() => navigate({ view: "buildings", building: null, unit: null, scenario: null, section: null, task: null })} aria-label="Buildings"><Building2 size={18} /><span>Buildings</span></button>
    </nav>
    {(state.view === "sale" && state.dataMode === "ready") && <nav className={s.saleNav} aria-label="Sale destinations">{["Progression", "Financials", "Commercial"].map(group => <div key={group}><p className={s.navGroup}>{group}</p>{sections.filter(section => section.group === group).map(section => {
      const Icon = icons[section.id];
      return <LocalLink key={section.id} href={prototypeUrl(search, { section: section.id, task: null })} onNavigate={() => navigate({ section: section.id, task: null })} className={s.saleLink} current={state.section === section.id} title={collapsed ? section.label : undefined}><Icon size={17} /><span>{section.label}</span>{state.section === section.id && <span className={s.activeDot} />}</LocalLink>;
    })}</div>)}</nav>}
    <button className={s.portfolioLink} onClick={() => navigate({ view: "portfolio", building: null, unit: null, scenario: null, section: null, task: null })} title="Portfolio overview"><LayoutDashboard size={16} /><span>Portfolio overview</span></button>
  </>;
}
export function SalesWorkspacePrototype() {
  const search = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const state = readNavigation(search);
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [discussions, setDiscussions] = useState<Record<string, DiscussionState>>({});
  const discussionKey = JSON.stringify([state.profile, state.role, state.building, state.unit.id]);
  const discussion = discussions[discussionKey] ?? { tab: "comments" as const, draft: "" };
  const fixture = conversationFixture(search);
  const commentCount = fixture === "empty" ? 0 : fixture === "long" ? 24 : 2;
  function changeDiscussion(patch: Partial<DiscussionState>) {
    setDiscussions(all => ({ ...all, [discussionKey]: { ...(all[discussionKey] ?? { tab: "comments", draft: "" }), ...patch } }));
  }
  const [preview, setPreview] = useState<Preview | null>(null);
  const building = buildings.find(b => b.id === state.building);
  const activeBuilding = building && !["buildings", "portfolio", "unavailable"].includes(state.view);
  const section = sections.find(s => s.id === state.section)!;
  useEffect(() => {
    const title = (state.view === "sale" && state.dataMode === "ready") ? building!.name + " · " + state.unit.unit_number + " · " + section.label + " | Bunnywell prototype" :
      activeBuilding ? building.name + " · " + (state.view === "worklist" ? "Sales" : "Dashboard") + " | Bunnywell prototype" :
      (state.view === "portfolio" ? "Portfolio overview" : state.view === "unavailable" ? "Workspace unavailable" : "Choose building") + " | Bunnywell prototype";
    // Next's streamed root metadata may arrive after hydration. Keep this tab's
    // explicit fixture context authoritative while the prototype is mounted.
    const updateTitle = () => { if (document.title !== title) document.title = title; };
    updateTitle();
    const observer = new MutationObserver(updateTitle);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [state.view, state.dataMode, state.unit.unit_number, building, activeBuilding, section.label]);
  useEffect(() => {
    const close = () => { setDrawer(null); setPreview(null); };
    window.addEventListener("popstate", close);
    return () => window.removeEventListener("popstate", close);
  }, []);
  // A deterministic delay to review loading UX, never a data-service request.
  // Both cancellation and the captured URL prevent an old building's timer publishing.
  useEffect(() => {
    if (state.dataMode !== "loading" || !state.building || ["buildings", "portfolio", "unavailable"].includes(state.view)) return;
    const owner = window.location.search;
    const timer = window.setTimeout(() => {
      if (window.location.search !== owner) return;
      window.history.replaceState(window.history.state, "", prototypeUrl(owner, { data: null }));
      window.dispatchEvent(new Event(eventName));
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [search, state.dataMode, state.building, state.view]);
  function navigate(change: Record<string, string | null>, options: Parameters<Navigate>[1] = {}) {
    if (state.view === "worklist") {
      try { sessionStorage.setItem(storageKey(state), JSON.stringify({ q: state.search, queue: state.queue, stage: state.stage, page: String(state.page), scroll: window.scrollY })); } catch { /* Navigation still works if storage is unavailable. */ }
    }
    const href = prototypeUrl(window.location.search, { building: state.building || null, profile: state.profile, role: state.role, ...change });
    window.history[options.replace ? "replaceState" : "pushState"]({ ...window.history.state }, "", href);
    setDrawer(null); setPreview(null);
    window.dispatchEvent(new Event(eventName));
    requestAnimationFrame(() => {
      if (!options.keepFocus) document.getElementById("workspace-heading")?.focus({ preventScroll: true });
      window.scrollTo({ top: options.scroll ?? 0, behavior: "instant" });
    });
  }
  function jumpToDiscussion() {
    document.getElementById("sale-context-heading")?.focus({ preventScroll: true });
    document.getElementById("sale-context-panel")?.scrollIntoView({ block: "nearest" });
  }
  function openWorklist(id = state.building) {
    const saved = savedList(state, id);
    navigate({ building: id, view: "worklist", unit: null, scenario: null, section: null, task: null, q: saved.q || null, stage: saved.stage || null, queue: saved.queue || null, data: id !== state.building && state.dataMode !== "loading" ? null : state.dataMode === "ready" ? null : state.dataMode, page: saved.page }, { scroll: saved.scroll });
  }
  function selectBuilding(id: string) {
    if (!accessibleBuildings(state.profile).some(b => b.id === id)) return;
    if (activeBuilding || drawer === "buildings") openWorklist(id);
    else navigate({ building: id, view: "dashboard", unit: null, scenario: null, section: null, task: null, data: null, q: null, queue: null, stage: null, page: null });
  }
  const navProps = { state, search, navigate, changeBuilding: () => setDrawer("buildings"), backToList: () => openWorklist() };
  const screenProps = { state, onPreview: setPreview, onTask: (task: string) => navigate({ task }) };
  const confirmation = state.section === "reservation" ? { title: "Approve reservation", action: "approve_reservation" as const } : state.section === "agent-fees" ? { title: "Approve invoice", action: "approve_agent_invoice" as const } : { title: "Confirm legal completion", action: "record_completion" as const };
  const unitPicker = <label className={s.field}>Switch unit in {building?.name}<select aria-label="Switch unit" value={state.unit.id} onChange={e => navigate(recordChange(units.find(u => u.id === e.target.value && u.building_id === state.building)!))}>{units.filter(u => u.building_id === state.building).map(u => <option key={u.id} value={u.id}>{u.unit_number} · {u.buyer}</option>)}</select></label>;
  return <div className={s.root} data-collapsed={collapsed}>
    <a href="#workspace-heading" className={s.skipLink}>Skip to current task</a>
    <aside className={s.sidebar} aria-label="Workspace navigation">
      <div className={s.brand} role="img" aria-label="Bunnywell Homes" />
      <Navigation {...navProps} collapsed={collapsed} />
      <button className={s.collapseButton} onClick={() => setCollapsed(v => !v)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}<span>Collapse sidebar</span></button>
    </aside>
    <div className={s.content}>
      <div className={s.prototypeBar} aria-label="Prototype controls"><span className={s.prototypeLabel}><span />LOCAL PROTOTYPE <small>Fictional snapshot · 3 Nov 2026</small>{activeBuilding && <label className={s.dataPreview}><span>Data</span><select aria-label="Prototype data state" value={state.dataMode} onChange={e => navigate({ data: e.target.value === "ready" ? null : e.target.value }, { keepFocus: true })}><option value="ready">Ready</option><option value="loading">Loading</option><option value="empty">Empty</option><option value="error">Error</option><option value="unavailable">Unavailable</option></select></label>}</span><div className={s.prototypeControls}>
        {(state.view === "sale" && state.dataMode === "ready") ? <label><span>Scenario</span><select aria-label="Prototype scenario" value={state.scenario.id} onChange={event => { const scenario = scenarios.find(s => s.id === event.target.value)!; navigate({ scenario: scenario.id, section: scenario.section, role: scenario.role, task: null }, { keepFocus: true }); }}>{scenarios.map(scenario => <option value={scenario.id} key={scenario.id}>{scenario.label}</option>)}</select></label> :
        <label><span>Access fixture</span><select aria-label="Prototype building access" value={state.profile} onChange={e => navigate({ profile: e.target.value, view: null, building: null, unit: null, scenario: null, section: null, q: null, stage: null, page: null })}><option value="multi">Several buildings</option><option value="single">One building</option></select></label>}
        <label><span>View as</span><select aria-label="Prototype role" value={state.role} onChange={e => navigate({ role: e.target.value }, { keepFocus: true })}>{Object.entries(roles).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      </div></div>
      <div className={s.breadcrumbBar}><button className={s.mobileMenu} onClick={() => setDrawer("navigation")} aria-label="Open navigation"><Menu size={20} /></button><nav aria-label="Breadcrumb" className={s.breadcrumbs}>
        <LocalLink href={prototypeUrl("", { view: "buildings", profile: state.profile, role: state.role })} onNavigate={() => navigate({ view: "buildings", building: null, unit: null, scenario: null, section: null, task: null })}>Buildings</LocalLink>
        {activeBuilding && <><ChevronRight size={14} /><LocalLink href={prototypeUrl("", { building: building.id, profile: state.profile, role: state.role })} onNavigate={() => navigate({ view: "dashboard", unit: null, scenario: null, section: null, task: null })}>{building.name}</LocalLink>
          {["worklist","sale"].includes(state.view) && <><ChevronRight size={14} /><LocalLink href={prototypeUrl("", { building: building.id, view: "worklist", profile: state.profile, role: state.role })} onNavigate={() => openWorklist()}>Sales</LocalLink></>}
          {(state.view === "sale" && state.dataMode === "ready") && <><ChevronRight size={14} /><LocalLink href={prototypeUrl(search, { section: "reservation", task: null })} onNavigate={() => navigate({ section: "reservation", task: null })}>{state.unit.unit_number}</LocalLink><ChevronRight size={14} /><span aria-current="page">{section.label}</span></>}
          {state.view === "dashboard" && <><ChevronRight size={14} /><span aria-current="page">Dashboard</span></>}
        </>}
        {state.view === "portfolio" && <><ChevronRight size={14} /><span aria-current="page">Portfolio overview</span></>}
      </nav><span className={s.avatar}>{state.role === "developer" ? "DM" : state.role === "sales_agent" ? "ST" : "JE"}</span></div>
      {activeBuilding && <header className={s.identity} aria-label={(state.view === "sale" && state.dataMode === "ready") ? "Sale identity" : "Building identity"}><span className={s.buildingIcon}><Building2 size={23} /></span><div className={s.identityText}><strong>{building.name}{(state.view === "sale" && state.dataMode === "ready") && <> <span>/</span> {state.unit.unit_number}</>}</strong><p>{(state.view === "sale" && state.dataMode === "ready") ? state.unit.buyer : building.address}</p></div>
        {(state.view === "sale" && state.dataMode === "ready") && <><div className={s.saleStatus}><span>Sale status</span><Badge tone={state.scenario.status === "Completed" ? "success" : "neutral"}>{state.scenario.status}</Badge></div><div className={s.unitSwitch}>{unitPicker}</div><button className={s.commentsButton} id="comments-toggle" onClick={jumpToDiscussion} aria-label="Comments and activity" aria-controls="sale-context-panel"><MessageSquare size={18} /><span>Comments & activity</span><small>{commentCount}</small></button></>}
        {(state.view !== "sale" || state.dataMode !== "ready") && <span className={s.identityRole}>{roles[state.role]} workspace</span>}
      </header>}
      <main className={s.main} id="prototype-main">
        {activeBuilding && <div className={s.backRow}>{(state.view === "sale" && state.dataMode === "ready") ? <button className={s.backButton} onClick={() => openWorklist()}><ArrowLeft size={15} />Back to worklist</button> : <span aria-hidden="true" />}<button className={s.backButton} onClick={() => setDrawer("buildings")}>Change building <Building2 size={15} /></button></div>}
        {state.view === "buildings" ? <BuildingChooser state={state} onSelect={selectBuilding} /> :
          state.view === "portfolio" ? <Portfolio state={state} onSelect={selectBuilding} /> :
          state.view === "unavailable" ? <><Heading eyebrow="Check the workspace link" title="Workspace unavailable" description="This building and record do not match, or are outside this fixture user’s access." /><Notice warning>No alternative unit has been opened. Choose a building to continue.</Notice><button className={s.button} onClick={() => navigate({ view: "buildings", building: null, unit: null })}>Choose building</button></> :
          activeBuilding && state.dataMode !== "ready" ? <FixtureDataState state={state} navigate={navigate} changeBuilding={() => setDrawer("buildings")} /> :
          state.view === "dashboard" ? <BuildingDashboard state={state} search={search} navigate={navigate} /> :
          state.view === "worklist" ? <Worklist state={state} search={search} navigate={navigate} /> :
          <div className={s.saleLayout}><div className={s.saleTask} data-testid="sale-task">{state.section === "completion" ? <CompletionWorkspace {...screenProps} /> : state.section === "agent-fees" ? <AgentFeesWorkspace key={state.scenario.id + state.unit.id} {...screenProps} /> : state.section === "reservation" ? <ReservationWorkspace {...screenProps} /> : <SummaryWorkspace state={state} />}</div><SaleContextPanel key={discussionKey} state={state} buildingName={building!.name} discussion={discussion} onChange={changeDiscussion} fixture={fixture} /></div>}
        {(state.view === "sale" && state.dataMode === "ready") && <div className={s.confirmationExample}><span>Prototype review tool</span><button className={s.textButton} onClick={() => setDrawer("confirmation")}>Preview action confirmation</button></div>}
        <footer className={s.pageFooter}><Sprout size={15} />Bunnywell Homes <span>·</span> A considered journey, from reservation to keys.</footer>
      </main>
    </div>
    {preview && <Modal title={building?.name + " · " + state.unit.unit_number + " — " + preview.title} wide onClose={() => setPreview(null)}><DocumentPreview preview={preview} unit={state.unit} /></Modal>}
    {drawer && <Modal title={drawer === "navigation" ? "Workspace navigation" : drawer === "buildings" ? "Choose your building" : "Confirmation preview"} onClose={() => setDrawer(null)}>
      {drawer === "buildings" ? <BuildingChooser state={state} onSelect={selectBuilding} switching /> :
        drawer === "navigation" ? <><div className={s.brand} role="img" aria-label="Bunnywell Homes" /><Navigation {...navProps} />{(state.view === "sale" && state.dataMode === "ready") && unitPicker}</> :
        <><Notice>Display example only. This confirmation cannot perform a business action.</Notice><h3>{confirmation.title}</h3><KeyValues items={[["Building", building!.name], ["Unit", state.unit.unit_number], ["Buyer", state.unit.buyer], ["Record reference", state.unit.id]]} /><p>Review the building and buyer before confirming this specific sale.</p><button className={s.primary} disabled>{confirmation.title} — {building!.name} / {state.unit.unit_number}</button>{!canPerformSalesAction(state.role, confirmation.action) && <p className={s.meta}>This action is not available to the selected role.</p>}<ReadOnlyNote /></>}
    </Modal>}
  </div>;
}

