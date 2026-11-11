
import fs from "node:fs";
const origin="https://vxkpvdtrldwwqiddoyof.supabase.co";
const tables=new Set("profiles buildings building_floors building_organisations organisations units unit_sale_attempts unit_sale_terms unit_sale_documents unit_sale_invoices unit_sale_invoice_payments sale_legal_emails sale_exchange_deposit_receipts sale_exchange_deposit_sources sale_further_deposit_facts user_unit_access user_building_access snags areas snag_photos snag_events building_sale_defaults trades unit_types audit_events".split(" "));
export function allowed(url,method="GET"){
 const u=new URL(url);
 if(u.origin!==origin)return false;
 if(u.pathname==="/auth/v1/user")return method==="GET";
 const rpc=u.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/);
 if(rpc)return ["sale_comment_page","sale_activity_page"].includes(rpc[1])&&["POST","GET"].includes(method);
 const table=u.pathname.match(/^\/rest\/v1\/([^/]+)$/);
 return Boolean(table&&tables.has(table[1])&&method==="GET");
}
if(process.env.WORKSPACE_STAGING_READS==="1"){
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!==origin)throw Error("Unexpected staging project");
 const original=globalThis.fetch;
 globalThis.fetch=async(input,options)=>{
  const target=typeof input==="string"?input:input instanceof URL?input.href:input.url;
  const method=(options?.method||(input instanceof Request?input.method:"GET")).toUpperCase(),u=new URL(target);
  if(!allowed(target,method))throw Error("Staging read guard blocked "+method+" "+u.origin+u.pathname);
  const at=performance.now();const response=await original(input,{...options,redirect:"error"});
  if(process.env.WORKSPACE_READ_LOG){
   const entry={method,path:u.pathname,filters:Object.fromEntries([...u.searchParams].filter(([k])=>k!=="select")),status:response.status,ms:Math.round(performance.now()-at)};
   void response.clone().arrayBuffer().then(b=>fs.appendFileSync(process.env.WORKSPACE_READ_LOG,JSON.stringify({...entry,bytes:b.byteLength})+"\n")).catch(()=>{});
  }
  return response;
 };
 process.env.WORKSPACE_READ_GUARD="1";
}
