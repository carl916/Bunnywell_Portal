import {integrationProject} from "./staging";
const origin="https://"+integrationProject+".supabase.co";
const tables=new Set("profiles buildings building_floors building_organisations organisations units unit_sale_attempts unit_sale_terms unit_sale_payment_schedule handovers unit_sale_documents unit_sale_document_versions unit_sale_invoices unit_sale_invoice_payments sale_legal_emails sale_exchange_deposit_receipts sale_exchange_deposit_sources sale_further_deposit_facts user_unit_access user_building_access snags areas snag_photos snag_events building_sale_defaults trades unit_types audit_events".split(" "));
export function allowedHostedRead(target:string,method="GET") {
 const u=new URL(target);if(u.origin!==origin)return false;
 if(u.pathname==="/auth/v1/user")return method==="GET";
 const rpc=u.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/);
 if(rpc)return ["sale_comment_page","sale_activity_page","workspace_access_context","workspace_building_facts"].includes(rpc[1])&&["GET","POST"].includes(method);
 const table=u.pathname.match(/^\/rest\/v1\/([^/]+)$/);
 if(table)return method==="GET"&&tables.has(table[1]);
 // Signing a verified private PDF is a read operation. Scope and Storage RLS still apply.
 return method==="POST"&&/^\/storage\/v1\/object\/sign\/sale-documents\/.+/.test(u.pathname);
}
export const hostedReadFetch:typeof fetch=async(input,options)=>{
 const target=typeof input==="string"?input:input instanceof URL?input.href:input.url;
 const method=(options?.method||(input instanceof Request?input.method:"GET")).toUpperCase();
 if(!allowedHostedRead(target,method))throw Error("Hosted read boundary rejected request");
 return fetch(input,{...options,redirect:"error"});
};