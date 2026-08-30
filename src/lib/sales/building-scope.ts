export function buildBuildingScopeOptions(buildings: Array<{ id: string; name: string }>) {
  return Array.from(new Map(buildings.map((building) => [building.id, building.name])).entries())
    .map(([id, name]) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name));
}
