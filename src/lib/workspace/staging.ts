export const integrationProject = "mmwzhzziqvjbsphrkbqr";
export const integrationVercelProject = "prj_YMaQDDgEtACwTijrmmh1SxQwsfe5";
export const hostedIntegration = process.env.NEXT_PUBLIC_WORKSPACE_INTEGRATION === "1";
export const foundationLocal = process.env.NEXT_PUBLIC_WORKSPACE_FOUNDATION === "1";
export const optimizedReads = foundationLocal || hostedIntegration;
export const stagingProject = hostedIntegration ? integrationProject : foundationLocal ? "bunnywell-backend-foundation" : "vxkpvdtrldwwqiddoyof";
export const stagingOrigin = foundationLocal && !hostedIntegration ? "http://127.0.0.1:55321" : "https://" + stagingProject + ".supabase.co";
export const stagingPath = "/workspace";
export function stagingEnabled(env: Record<string,string|undefined> = process.env) {
 if (env.NEXT_PUBLIC_WORKSPACE_INTEGRATION === "1") {
  return env.NEXT_PUBLIC_WORKSPACE_FOUNDATION !== "1" &&
   env.NEXT_PUBLIC_SUPABASE_URL === "https://" + integrationProject + ".supabase.co" &&
   env.WORKSPACE_HOSTED_READS === "1" &&
   env.WORKSPACE_READ_GUARD === "1" &&
   (!env.VERCEL || env.VERCEL_PROJECT_ID === integrationVercelProject);
 }
 return env.NODE_ENV === "development" && env.WORKSPACE_STAGING_READS === "1" &&
  env.NEXT_PUBLIC_SUPABASE_URL === stagingOrigin && env.WORKSPACE_READ_GUARD === "1";
}
export const moduleAllowed = (role:string, module:string) =>
 module === "dashboard" ? ["admin","developer","developer_representative","contractor","sales_agent","conveyancer"].includes(role) :
 module === "sales" ? ["admin","developer","sales_agent","conveyancer"].includes(role) :
 module === "snags" ? ["admin","developer","developer_representative","contractor"].includes(role) :
 ["buildings","setup"].includes(module)&&["admin","developer"].includes(role);

export function completionWritesEnabled(env:Record<string,string|undefined>=process.env){return stagingEnabled(env)&&env.NEXT_PUBLIC_WORKSPACE_INTEGRATION==="1"&&env.WORKSPACE_COMPLETION_WRITES==="1"&&Boolean(env.SUPABASE_SERVICE_ROLE_KEY);}


export function coreSalesEnabled(env:Record<string,string|undefined>=process.env){return completionWritesEnabled(env)&&env.WORKSPACE_CORE_SALES_WRITES==="1";}
