// Mirrors the existing workspace_snag_operation developer review guard.
// The server still validates role, building access, status and expected revision.
export function canCloseSnag(role:string,status:string,editable:boolean) {
  return editable && ["admin","developer","developer_representative"].includes(role) && status !== "closed";
}
export type SnagAction={id:string;label:string;comment:string;requiredComment:boolean;media:boolean;requiredMedia?:boolean;success:string};
export function permittedSnagActions(role:string,status:string,editable:boolean):SnagAction[]{
 if(!editable||status==="closed"||!["admin","developer","developer_representative","contractor"].includes(role))return [];
 const actions:SnagAction[]=[],dev=role!=="contractor";
 if(dev&&status==="needs_more_info")actions.push({id:"answer_snag_info",label:"Supply requested information",comment:"Response",requiredComment:true,media:true,success:"Information supplied. Snag returned to the contractor."});
 if(!["resolved_by_contractor","needs_more_info"].includes(status))actions.push(
  {id:"resolve_snag",label:"Mark resolved",comment:"Resolution comment (optional)",requiredComment:false,media:true,success:"Snag marked resolved for developer review."},
  {id:"request_snag_info",label:"Request more information",comment:"Question",requiredComment:true,media:false,success:"More information requested. Activity updated."});
 if(dev&&status==="resolved_by_contractor")actions.push({id:"reject_snag",label:"Return to contractor",comment:"Reason for returning",requiredComment:true,media:true,success:"Resolution returned to the contractor."});
 if(canCloseSnag(role,status,editable))actions.push({id:"close_snag",label:"Close snag",comment:"Review comment (optional)",requiredComment:false,media:false,success:"Snag closed after developer review."});
 actions.push({id:"add_snag_media",label:"Add evidence",comment:"Evidence note (optional)",requiredComment:false,media:true,requiredMedia:true,success:"Evidence added to this snag."});
 return actions;
}
