export type FlatAssignment={unitId:string;accessType:string};
/** One selector per unit, even where legacy data has several relationship rows. */
export function residentFlatRows(assignments:FlatAssignment[]){
 return [...new Map(assignments.map(a=>[a.unitId,a])).values()];
}
/** Preserve all existing relationship values, including Representative, for retained units. */
export function residentAssignments(rows:FlatAssignment[],existing:FlatAssignment[],residentType:string){
 if(new Set(rows.map(a=>a.unitId)).size!==rows.length)throw Error('Choose each flat only once.');
 return rows.flatMap(row=>{
  const retained=existing.filter(a=>a.unitId===row.unitId);
  return retained.length?retained:[{unitId:row.unitId,accessType:residentType}];
 });
}
