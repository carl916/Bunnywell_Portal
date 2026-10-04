// Match the inputs to portal role and organisation scoping. Sorting avoids
// refreshing merely because the database returns access links in another order.
export function portalAccessKey(profile: { id: string; role: string; active?: boolean | null; organisation_id?: string | null } | null,
  units: { unit_id: string }[], buildings: { building_id: string }[],
  links: { building_id: string; organisation_id: string; role_on_project: string; active?: boolean | null }[]) {
  return JSON.stringify([
    profile && [profile.id, profile.role, profile.active, profile.organisation_id],
    units.map(row => row.unit_id).sort(), buildings.map(row => row.building_id).sort(),
    links.filter(row => row.organisation_id === profile?.organisation_id)
      .map(row => JSON.stringify([row.building_id, row.role_on_project, row.active])).sort(),
  ]);
}
