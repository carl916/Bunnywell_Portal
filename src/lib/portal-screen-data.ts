// Screen dependencies only; authentication and authorised building scope always
// load in the portal shell. Keep these lists aligned with the screen's props.
export type PortalScreenResource = 'areas' | 'floors' | 'unitTypes' | 'unitTypeAreas' | 'trades' | 'organisations' | 'profiles' | 'buildingAccess' | 'unitAccess' | 'accessRequests' | 'snags' | 'photos' | 'events' | 'handovers' | 'handoverKeys' | 'handoverPhotos' | 'meters';
const operational: PortalScreenResource[] = ['floors', 'areas', 'trades', 'organisations', 'profiles', 'buildingAccess', 'unitAccess', 'snags', 'photos', 'events', 'handovers', 'handoverKeys', 'handoverPhotos', 'meters'];
export function portalScreenResources(screen: string, role: string): PortalScreenResource[] {
  switch (screen) {
    case 'sales': case 'setup_activity': return ['floors', 'organisations', 'profiles'];
    case 'rentals': return ['floors', 'organisations'];
    case 'setup_buildings': return ['floors', 'areas', 'unitTypes', 'unitTypeAreas', 'organisations'];
    case 'setup_allocation': return ['floors'];
    case 'setup_people': return ['floors', 'organisations', 'profiles', 'buildingAccess', 'unitAccess', ...(role === 'admin' ? ['accessRequests' as const] : [])];
    case 'snags': case 'units': case 'resident_home': case 'resident_snags': return operational;
    default: return [];
  }
}

/** Per-mounted-portal loaded state, with shared in-flight reads. Never persisted.
 * Auth/access changes and explicit/mutation refreshes invalidate every resource.
 * A failed or superseded read never marks an empty dataset as loaded.
 */
export function createPortalScreenLoader() {
  let epoch = 0;
  const ready = new Set<PortalScreenResource>();
  const pending = new Map<PortalScreenResource, Promise<void>>();
  return {
    invalidate() { epoch++; ready.clear(); pending.clear(); },
    loaded: () => [...ready],
    async ensure(resources: PortalScreenResource[], read: (resource: PortalScreenResource) => Promise<unknown[]>, publish: (resource: PortalScreenResource, rows: unknown[]) => void) {
      const current = epoch;
      const results = await Promise.allSettled(resources.map(resource => {
        if (ready.has(resource)) return Promise.resolve();
        if (pending.has(resource)) return pending.get(resource)!;
        const promise = Promise.resolve().then(() => read(resource)).then(rows => {
          if (current !== epoch) return;
          ready.add(resource);
          publish(resource, rows);
        }).finally(() => { if (current === epoch) pending.delete(resource); });
        pending.set(resource, promise);
        return promise;
      }));
      if (current !== epoch) return;
      const failure = results.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
    },
  };
}
