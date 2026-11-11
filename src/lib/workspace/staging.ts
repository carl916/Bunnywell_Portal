export const stagingProject = "vxkpvdtrldwwqiddoyof";
export const stagingOrigin = "https://" + stagingProject + ".supabase.co";
export const stagingPath = "/workspace";
export function stagingEnabled(env: Record<string,string|undefined> = process.env) {
 return env.NODE_ENV === "development" && env.WORKSPACE_STAGING_READS === "1" &&
 env.NEXT_PUBLIC_SUPABASE_URL === stagingOrigin && env.WORKSPACE_READ_GUARD === "1";
}
export const moduleAllowed = (role:string, module:string) =>
 module === "dashboard" ? ["admin","developer","developer_representative","contractor","sales_agent","conveyancer"].includes(role) :
 module === "sales" ? ["admin","developer","sales_agent","conveyancer"].includes(role) :
 module === "snags" ? ["admin","developer","developer_representative","contractor"].includes(role) :
 ["buildings","setup"].includes(module)&&["admin","developer"].includes(role);
