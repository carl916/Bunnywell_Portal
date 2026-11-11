"use client";
import { buildings, type NavigationState } from "@/lib/experiments/sales-workspace/model";
import { Heading } from "./PrototypeUI";
import type { Navigate } from "./BuildingScreens";
import s from "./Workspace.module.css";

export function FixtureDataState({ state, navigate, changeBuilding }: { state: NavigationState; navigate: Navigate; changeBuilding: () => void }) {
  const name = buildings.find(b => b.id === state.building)!.name;
  const mode = state.dataMode;
  const title = mode === "loading" ? "Loading " + name : mode === "empty" ? "No sales to show" : mode === "error" ? "Sales could not be loaded" : "Building unavailable";
  return <><Heading eyebrow="Building workspace / Sample data state" title={title}
    description={mode === "loading" ? "Preparing this building’s workspace." : mode === "empty" ? "There are no sales records in this sample result for " + name + "." : mode === "error" ? "We could not retrieve the sample workspace for " + name + "." : "Access to " + name + " is unavailable in this sample state."} />
    <section className={s.stateCard} aria-busy={mode === "loading"} aria-label="Workspace data state">
      {mode === "loading" ? <><p role="status">Loading this building only…</p><div className={s.skeleton} aria-hidden="true" /><div className={s.skeleton} aria-hidden="true" /><p className={s.meta}>Local preview: completes after 5 seconds. You can change building while it loads.</p></> :
       <><p role={mode === "error" ? "alert" : "status"}>{mode === "empty" ? "No records have been returned. This is different from a failed load." : mode === "error" ? "No records are displayed until the load succeeds." : "No records or unit actions are available in this building."}</p><div className={s.actions}>
       {mode === "error" && <button className={s.button} onClick={() => navigate({ data: "loading" })}>Retry sample load</button>}
       {mode === "empty" && <button className={s.button} onClick={() => navigate({ data: null })}>Show populated fixture</button>}
       <button className={s.button} onClick={changeBuilding}>Choose another building</button></div><p className={s.meta}>Fictional display state · no service request is made.</p></>}
    </section></>;
}
