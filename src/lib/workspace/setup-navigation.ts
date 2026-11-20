export const setupScreens = ["setup_buildings", "setup_allocation", "setup_activity", "setup_people"] as const;

export function setupHref(values: Record<string, string> = {}) {
  const tab=values.screen==='setup_activity'?'audit':values.screen==='setup_people'?'people':values.screen==='setup_allocation'?'allocation':values.tab||'buildings';
  return '/workspace?'+new URLSearchParams({view:'setup',tab,...(values.building&&values.building!=='all'?{building:values.building}:{})});
}

export function isSetupDestination(values: Record<string, string>) {
  return values.view === "setup" || values.view === "building-settings"
    || values.view === "buildings" && values.destination === "building-settings";
}

export function workspaceHref(screen: string, buildingId: string, unitId?: string, saleId?: string) {
  const building = buildingId && buildingId !== "all" ? buildingId : "";
  const view = !building ? "buildings" : screen === "sales" ? (unitId ? "sale" : "worklist")
    : screen === "snags" ? "snags" : "dashboard";
  return "/workspace?" + new URLSearchParams({view, ...(building ? {building} : {}),
    ...(view === "sale" && unitId ? {unit: unitId, ...(saleId ? {sale: saleId} : {})} : {})});
}

// Public access requests remain available; administration uses workspace boundaries.
export function setupApiAllowed(path:string,method:string){return path==='/api/access-requests'&&['GET','POST'].includes(method);}
