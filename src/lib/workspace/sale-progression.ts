import type {WorkSale,WorkDocument,WorkAuthority} from "@/lib/dashboard/types";
import {completionDocumentsApproved,currentCompletionVersion} from "@/lib/sales/completion-review";
export type SaleProgression={
 current:"reservation"|"exchange"|"completion"|"handover";
 destination:{section:string;task?:string};
 next:string;responsible:string;
 stages:Record<string,"complete"|"current"|"future">;
 steps:Record<string,"complete"|"current"|"future">;
};
// Presentation of authoritative facts only; never a replacement for command
// permissions, prerequisite validation or current-version approval checks.
export function saleProgression(sale:WorkSale,documents:Pick<WorkDocument,'document_type'|'status'|'approved_version_id'|'unit_sale_document_versions'>[],authorities:WorkAuthority[]=[],now=Date.now()):SaleProgression{
 const completed=Boolean(sale.legal_completed_at||sale.completed_at||sale.workflow_status==='completed');
 const exchanged=completed||Boolean(sale.exchanged_at);
 const reserved=exchanged||Boolean(sale.reservation_approved_at)||['approved','reservation_approved','awaiting_commercial_approval','ready_for_exchange'].includes(sale.workflow_status);
 const authority=completed||Boolean(sale.completion_authority_given_at||sale.completion_arrangements_confirmed_at||sale.completion_legacy_stage);
 const notice=completed||Boolean(sale.completion_arrangements_confirmed_at||sale.completion_legacy_stage==='arrangements');
 const reviewed=completionDocumentsApproved(documents);
 const task=completed?'legal':!authority?'authority':!notice?'notice':!reviewed?'documents':'legal';
 const current=completed?'handover':exchanged?'completion':reserved?'exchange':'reservation';
 const reviewing=['awaiting_approval','reservation_submitted'].includes(sale.workflow_status);
 const needsFiles=documents.some(d=>['completion_statement','draft_statement_of_account'].includes(d.document_type)&&d.status==='query_raised')||['completion_statement','draft_statement_of_account'].some(t=>!currentCompletionVersion(documents.find(d=>d.document_type===t)));
 const latest=authorities.filter(a=>a.kind==='authority').sort((a,b)=>b.version-a.version)[0];
 const exchangeReady=latest&&!latest.revoked_at&&!latest.replaced_by&&latest.expires_at&&Date.parse(latest.expires_at)>now&&(latest.sent_at||latest.delivery_status==='captured_test');
 const requestPending=sale.authority_requested_at&&(!latest||Date.parse(sale.authority_requested_at)>=Math.min(...[latest.revoked_at,latest.expires_at].filter((v):v is string=>Boolean(v)).map(Date.parse)));
 const exchangeNext=exchangeReady?'Record exchange':requestPending?'Review exchange authority request':latest?'Request renewed exchange authority':'Request exchange authority';
 const next=completed?'Legal completion recorded':exchanged?({authority:sale.completion_authority_requested_at?'Give authority to serve notice':'Request authority to serve notice',notice:'Record notice and due date',documents:needsFiles?'Upload or revise completion documents':'Review completion documents',legal:'Record legal completion'}[task]):reserved?exchangeNext:reviewing?'Review reservation':'Prepare reservation and commercial terms';
 const responsible=completed?'Recorded':exchanged?(task==='authority'&&sale.completion_authority_requested_at||task==='documents'&&!needsFiles?'Developer':'Conveyancer'):reserved?(requestPending&&!exchangeReady?'Developer':'Conveyancer'):reviewing?'Developer':'Sales Agent / Developer';
 return {current,destination:completed?{section:'completion',task:'legal'}:exchanged?{section:'completion',task}:reserved?{section:'exchange'}:{section:'reservation'},next,responsible,
 stages:{reservation:reserved?'complete':'current',exchange:exchanged?'complete':reserved?'current':'future',completion:completed?'complete':exchanged?'current':'future',handover:completed?'current':'future'},
 steps:{authority:authority?'complete':exchanged?'current':'future',notice:notice?'complete':authority?'current':'future',documents:reviewed?'complete':notice?'current':'future',legal:completed?'complete':reviewed&&notice?'current':'future'}};
}
