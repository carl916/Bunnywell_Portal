export const integrationProject = "mmwzhzziqvjbsphrkbqr";
export const integrationVercelProject = "prj_YMaQDDgEtACwTijrmmh1SxQwsfe5";
export const hostedIntegration = runtimeEnv().NEXT_PUBLIC_WORKSPACE_INTEGRATION === "1";
export const hostedStaging = runtimeEnv().NEXT_PUBLIC_WORKSPACE_STAGING === "1";
export const hostedWorkspace = hostedIntegration || hostedStaging;
export const foundationLocal = runtimeEnv().NEXT_PUBLIC_WORKSPACE_FOUNDATION === "1";
export const optimizedReads = foundationLocal || hostedWorkspace;
export const stagingProject = hostedIntegration ? integrationProject : foundationLocal ? "bunnywell-backend-foundation" : "vxkpvdtrldwwqiddoyof";
export const stagingOrigin = foundationLocal && !hostedIntegration ? "http://127.0.0.1:55321" : "https://" + stagingProject + ".supabase.co";
export const stagingPath = "/workspace";
export function stagingEnabled(env: Record<string,string|undefined> = runtimeEnv()) {
 if (env.NEXT_PUBLIC_WORKSPACE_STAGING === "1") {
  return env.NEXT_PUBLIC_WORKSPACE_INTEGRATION !== "1" && env.NEXT_PUBLIC_WORKSPACE_FOUNDATION !== "1" &&
   env.NEXT_PUBLIC_SUPABASE_URL === "https://vxkpvdtrldwwqiddoyof.supabase.co" &&
   env.WORKSPACE_HOSTED_READS === "1" && env.WORKSPACE_READ_GUARD === "1" &&
   (!env.VERCEL || (env.VERCEL_PROJECT_ID === "prj_4s8vIyfrGh9DSGJcixTU5slevr5P" && env.VERCEL_ENV === "preview"));
 }
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

export function completionWritesEnabled(env:Record<string,string|undefined>=runtimeEnv()){return stagingEnabled(env)&&(env.NEXT_PUBLIC_WORKSPACE_INTEGRATION==="1"||env.NEXT_PUBLIC_WORKSPACE_STAGING==="1")&&env.WORKSPACE_COMPLETION_WRITES==="1"&&Boolean(env.SUPABASE_SERVICE_ROLE_KEY);}


export function coreSalesEnabled(env:Record<string,string|undefined>=runtimeEnv()){return completionWritesEnabled(env)&&env.WORKSPACE_CORE_SALES_WRITES==="1";}
export function operationsWritesEnabled(env:Record<string,string|undefined>=runtimeEnv()){return coreSalesEnabled(env)&&env.WORKSPACE_OPERATIONS_WRITES==="1";}

function runtimeEnv(){return {NODE_ENV:process.env.NODE_ENV,NEXT_PUBLIC_WORKSPACE_STAGING:process.env.NEXT_PUBLIC_WORKSPACE_STAGING,NEXT_PUBLIC_WORKSPACE_INTEGRATION:process.env.NEXT_PUBLIC_WORKSPACE_INTEGRATION,NEXT_PUBLIC_WORKSPACE_FOUNDATION:process.env.NEXT_PUBLIC_WORKSPACE_FOUNDATION,NEXT_PUBLIC_SUPABASE_URL:process.env.NEXT_PUBLIC_SUPABASE_URL,WORKSPACE_HOSTED_READS:process.env.WORKSPACE_HOSTED_READS,WORKSPACE_READ_GUARD:process.env.WORKSPACE_READ_GUARD,WORKSPACE_STAGING_READS:process.env.WORKSPACE_STAGING_READS,VERCEL:process.env.VERCEL,VERCEL_PROJECT_ID:process.env.VERCEL_PROJECT_ID,VERCEL_ENV:process.env.VERCEL_ENV,WORKSPACE_COMPLETION_WRITES:process.env.WORKSPACE_COMPLETION_WRITES,WORKSPACE_CORE_SALES_WRITES:process.env.WORKSPACE_CORE_SALES_WRITES,WORKSPACE_OPERATIONS_WRITES:process.env.WORKSPACE_OPERATIONS_WRITES,SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY};}
