type Evidence = {id:string;created_at:string;media_type?:string|null;photo_type?:string|null};
// Share the same selection for the register and the record. Markings come first.
export function compareSnagEvidence(a:Evidence,b:Evidence){
 const rank=(p:Evidence)=>p.media_type==="video"?3:p.photo_type==="annotated"?0:p.photo_type==="original"?1:2;
 return rank(a)-rank(b)||a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id);
}
