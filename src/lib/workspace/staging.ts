export const foundationLocal = process.env.NEXT_PUBLIC_WORKSPACE_FOUNDATION === "1";
export const stagingProject = foundationLocal ? "bunnywell-backend-foundation" : "vxkpvdtrldwwqiddoyof";
export const stagingOrigin = foundationLocal ? "http://127.0.0.1:55321" : "https://" + stagingProject + ".supabase.co";
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
