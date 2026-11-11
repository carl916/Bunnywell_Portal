// Approved synthetic setup only. Never overwrites or unlocks an existing sale.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { isolation, sql } from "./runtime.mjs";
import { writeReviewPdfs } from "./synthetic-review-pdfs.mjs";
isolation();
const status = JSON.parse(readFileSync("local-runtime/status.json", "utf8").replace(/^\uFEFF/, ""));
if (status.API_URL !== "http://127.0.0.1:54321") throw Error("Local environment required");
if (sql("select count(*) from cron.job where active and command ~* 'net.http|http_post|curl|https?://';").trim() !== "0") throw Error("Outbound job found");
const client = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const buckets = await client.storage.listBuckets();
if (buckets.error) throw buckets.error;
if (!buckets.data.some(b => b.id === "sale-documents")) {
  // Same settings as ensureSaleDocumentsBucket in the existing reservations route.
  const created = await client.storage.createBucket("sale-documents", { public: false, fileSizeLimit: 10 * 1024 * 1024, allowedMimeTypes: ["application/pdf"] });
  if (created.error) throw created.error;
}
if (sql("select count(*) from storage.buckets where id in ('sale-documents','completion-uploads') and public;").trim() !== "0") throw Error("Document bucket must be private");
const test = process.argv.includes("--test");
const name = test ? "T" + Date.now().toString().slice(-7) : "CR01";
const existing = JSON.parse(sql("select coalesce(json_agg(json_build_object('buildingId',a.building_id,'unitId',u.id,'saleId',a.id,'unitNumber',u.unit_number)),'[]') from units u join unit_sale_attempts a on a.unit_id=u.id and a.is_active where u.building_id='b1700000-0000-4000-8000-000000000001' and u.unit_number='" + name + "';"));
let record = existing[0];
if (!record) {
  const unit = randomUUID(), sale = randomUUID(), terms = randomUUID();
  sql(`begin;
  set local request.jwt.claims = '{"role":"service_role"}';
  set local app.sales_legal_write = 'on';
  set local app.completion_package_write = 'on';
  insert into units(id,building_id,unit_number,floor,sale_status,unit_type)
  values('${unit}','b1700000-0000-4000-8000-000000000001','${name}','Ground','for_sale','Apartment');
  insert into unit_sale_attempts(id,building_id,unit_id,workflow_status,buyer_person_name,is_active,
    exchanged_at,reservation_approved_at,commercial_approved_at,completion_authority_given_at,
    completion_arrangements_confirmed_at,completion_notice_issued_at,contractual_completion_date,
    sales_agent_organisation_id,conveyancer_organisation_id,created_by_user_id,updated_by_user_id,reservation_date)
  select '${sale}',building_id,'${unit}','draft','Fictional Completion Reviewer',true,
    exchanged_at,reservation_approved_at,commercial_approved_at,completion_authority_given_at,
    completion_arrangements_confirmed_at,completion_notice_issued_at,contractual_completion_date,
    sales_agent_organisation_id,conveyancer_organisation_id,created_by_user_id,updated_by_user_id,reservation_date
  from unit_sale_attempts where id='b1700000-0000-4000-8000-000000001100';
  insert into unit_sale_terms select (jsonb_populate_record(null::unit_sale_terms,
    to_jsonb(t)||jsonb_build_object('id','${terms}','sale_attempt_id','${sale}'))).* from unit_sale_terms t
    where sale_attempt_id='b1700000-0000-4000-8000-000000001100' and is_current;
  update unit_sale_attempts set workflow_status='exchanged' where id='${sale}';
  set local app.unit_commercial_mutation = 'on';
  update units set sale_status='exchanged' where id='${unit}';
  commit;`);
  record = { buildingId: "b1700000-0000-4000-8000-000000000001", unitId: unit, saleId: sale, unitNumber: name };
}
const out = "artifacts/building-workspace-stage2/completion-review";
mkdirSync(out, { recursive: true });
writeFileSync(out + (test ? "/test-record.json" : "/review-record.json"), JSON.stringify(record, null, 2));
if (!test) writeReviewPdfs(out + "/review-files", record.unitNumber);
console.log(JSON.stringify(record));
