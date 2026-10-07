import { sortUnitsByBuildingFloorOrder } from '../../src/lib/units/commercial-allocation.ts';
import { completionDocumentApproved, completionDocumentTypes } from '../../src/lib/sales/completion-review.ts';
import { completionNoticeState } from '../../src/lib/sales/completion-notice.ts';
import { absoluteSaleFileUrl } from '../../src/lib/portal-url.ts';
import { truth, json, number } from './read-dump.mjs';
import { storageReference } from './assets.mjs';

export const label = value => String(value ?? '').replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
const index = rows => new Map(rows.map(row => [row.id, row]));
const byDate = (a, b) => String(b.created_at ?? b.issued_at ?? '').localeCompare(String(a.created_at ?? a.issued_at ?? ''));
const money = value => number(value);
const contribution = (terms, key) => {
  const value = money(terms[`${key}_value`] ?? terms[key]);
  if (terms[`${key}_value_type`] !== 'percent' || value == null) return value;
  const price = money(terms.contract_price);
  return price == null ? null : Math.round(price * value) / 100;
};

export function progression(attempt, documents, emails, snapshot) {
  if (!attempt) return ['Record sale preparation', 'Sales agent'];
  const status = attempt.workflow_status;
  if (!truth(attempt.is_active) || ['fallen_through', 'superseded', 'cancelled'].includes(status)) return ['Historical sale', ''];
  if (attempt.completed_at || status === 'completed') return ['Arrange handover / check final account', 'Conveyancer / developer'];
  const exchanged = attempt.exchanged_at || ['exchanged', 'completion_pending'].includes(status);
  if (!exchanged) {
    if (['draft', 'rejected', 'reservation_query_raised'].includes(status)) return [status === 'draft' ? 'Prepare reservation' : 'Respond to reservation query', 'Sales agent'];
    if (['awaiting_approval', 'reservation_submitted'].includes(status)) return ['Approve reservation', 'Developer'];
    if (!attempt.commercial_approved_at) return ['Confirm commercial terms', 'Developer'];
    const authority = emails.filter(e => e.kind === 'authority').sort((a, b) => Number(b.version) - Number(a.version))[0];
    if (!authority || authority.revoked_at || authority.replaced_by || (authority.expires_at && Date.parse(authority.expires_at) <= Date.parse(snapshot))) return ['Issue / renew authority to exchange', 'Developer'];
    if (!['sent', 'delivered', 'delivery_delayed', 'opened', 'clicked'].includes(authority.delivery_status)) return ['Check authority email delivery', 'Developer'];
    return ['Record exchange', 'Conveyancer'];
  }
  const notice = completionNoticeState(attempt);
  if (!notice.authorised) return ['Give authority to serve notice', 'Developer'];
  if (!notice.confirmed) return ['Record notice and completion due date', 'Conveyancer'];
  const required = completionDocumentTypes.map(type => documents.find(d => d.document_type === type));
  if (required.some(d => d?.status === 'query_raised')) return ['Respond to completion document query', 'Conveyancer'];
  if (required.some(d => !d?.unit_sale_document_versions.some(v => v.is_current && !v.redacted_at))) return ['Upload completion documents', 'Conveyancer'];
  if (!required.every(completionDocumentApproved)) return ['Review current completion documents', 'Developer'];
  return [attempt.contractual_completion_date ? 'Confirm legal completion' : 'Confirm contractual completion date', 'Conveyancer'];
}

export function buildModel(data, { snapshot, projectRef, portalUrl = 'https://portal.bunnywell.co.uk' }) {
  const buildings = [...data.buildings].sort((a, b) => a.name.localeCompare(b.name));
  const units = sortUnitsByBuildingFloorOrder(data.units, data.building_floors.map(f => ({ ...f, sort_order: number(f.sort_order) })), buildings);
  const B = index(buildings), U = index(units), A = index(data.areas), P = index(data.profiles), O = index(data.organisations), T = index(data.trades);
  const S = index(data.unit_sale_attempts), H = index(data.handovers);
  const unitOrder = new Map(units.map((u, i) => [u.id, i]));
  const person = id => P.get(id)?.full_name || P.get(id)?.name || (id ? 'Unknown user' : '');
  const organisation = id => O.get(id)?.name || '';
  const location = (unitId, buildingId, areaId) => { const u = U.get(unitId), area = A.get(areaId); return {
    building: B.get(buildingId || u?.building_id || area?.building_id)?.name ?? '', floor: u?.floor || area?.floor || '', unit: u?.unit_number || '', area: area?.name || '',
  }; };
  const saleLocation = id => { const s = S.get(id); return { ...location(s?.unit_id, s?.building_id), saleId: id }; };
  const saleUrl = id => { const s = S.get(id); return s ? absoluteSaleFileUrl({ ...s, sale_attempt_id: s.id }, portalUrl) : ''; };
  const documents = data.unit_sale_documents.filter(d => !d.redacted_at).map(d => ({ ...d,
    unit_sale_document_versions: data.unit_sale_document_versions.filter(v => v.document_id === d.id && !v.redacted_at).map(v => ({ ...v, is_current: truth(v.is_current) })),
  }));
  const references = [], exceptions = [];
  function reference({ bucket, key, url, ...ref }) {
    const resolved = bucket && key ? { bucket, key } : storageReference(url, projectRef);
    if (resolved?.external) { ref.external = resolved.external; exceptions.push({ ...ref, issue: 'External link: contents are not included in this backup' }); }
    else if (resolved) Object.assign(ref, resolved);
    else if (url || key) { exceptions.push({ ...ref, issue: 'File reference could not be resolved' }); ref.unresolved = true; }
    else return null;
    references.push(ref); return ref;
  }
  for (const d of documents) for (const v of d.unit_sale_document_versions) reference({ ...saleLocation(d.sale_attempt_id), id: v.id, parentId: d.id,
    kind: label(d.document_type), name: v.file_name, bucket: v.storage_bucket, key: v.storage_path,
    expectedBytes: v.file_size_bytes, expectedHash: v.checksum, version: number(v.version_number), current: v.is_current,
    status: !v.is_current ? 'Superseded version' : d.status === 'approved' && d.approved_version_id !== v.id ? 'Awaiting current version approval' : label(d.status), approved: d.approved_version_id === v.id && d.status === 'approved', query: d.query_note,
    actor: person(v.uploaded_by_user_id), date: v.uploaded_at, liveUrl: saleUrl(d.sale_attempt_id) });
  const snagIndex = index(data.snags);
  for (const photo of data.snag_photos) {
    const snag = snagIndex.get(photo.snag_id);
    reference({ ...location(snag?.unit_id, snag?.building_id, snag?.area_id), id: photo.id, parentId: photo.snag_id, kind: label(photo.photo_type),
      name: photo.caption || `Snag ${photo.snag_id} ${label(photo.media_type || 'image')}`, url: photo.file_url,
      ...(photo.storage_path ? { bucket: 'snag-images', key: photo.storage_path } : {}), date: photo.created_at,
      expectedBytes: photo.file_size_bytes, actor: person(photo.uploaded_by_user_id) });
  }
  for (const snag of data.snags.filter(s => s.image_path && !data.snag_photos.some(p => p.snag_id === s.id))) reference({
    ...location(snag.unit_id, snag.building_id, snag.area_id), id: `legacy-${snag.id}`, parentId: snag.id, kind: 'Original image', name: snag.title,
    ...(snag.image_path.startsWith('http') ? { url: snag.image_path } : { bucket: 'snag-images', key: snag.image_path }) });
  for (const r of data.snag_reports) reference({ ...location(r.unit_id, r.building_id, r.communal_area_id), id: r.id, parentId: r.id,
    kind: 'Snag report', name: `${r.location_label || 'Snag report'}.pdf`, bucket: r.file_path ? 'snag-reports' : undefined, key: r.file_path, url: r.file_url, date: r.created_at,
    actor: person(r.sent_by_user_id), status: r.sent_at ? 'Sent' : 'Saved', relatedSnags: data.snag_report_items.filter(i => i.report_id === r.id).map(i => i.snag_id).join(', ') });
  for (const r of data.reports ?? []) reference({ ...location(r.unit_id, r.building_id), id: r.id, parentId: r.unit_id || r.building_id,
    kind: label(r.report_type), name: label(r.report_type), url: r.file_url, date: r.created_at });
  for (const h of data.handovers) reference({ ...location(h.unit_id), id: `signature-${h.id}`, parentId: h.id, kind: 'Handover signature', name: 'Signature', url: h.signature_url, date: h.handover_date });
  for (const p of data.handover_photos) reference({ ...location(H.get(p.handover_id)?.unit_id), id: p.id, parentId: p.handover_id, kind: 'Handover photograph', name: p.caption || 'Handover photograph', url: p.file_url, date: p.created_at });
  for (const m of data.meter_readings) reference({ ...location(m.unit_id, m.building_id), id: m.id, parentId: m.handover_id, kind: 'Meter photograph', name: label(m.meter_type), url: m.photo_url, date: m.reading_date });
  for (const b of buildings) for (const [field, kind] of [['photo_url', 'Building photograph'], ['documents_url', 'Building documents'], ['home_user_guide_url', 'Home user guide']]) reference({
    building: b.name, id: `${b.id}-${field}`, parentId: b.id, kind, name: kind, url: b[field] });
  for (const e of data.sale_legal_emails) references.push({ ...saleLocation(e.sale_attempt_id), id: e.id, parentId: e.sale_attempt_id, kind: 'Legal correspondence', name: e.subject,
    date: e.issued_at, status: label(e.delivery_status), liveUrl: saleUrl(e.sale_attempt_id),
    correspondence: [`Subject: ${e.subject}`, `Issued: ${e.issued_at}`, `Sent: ${e.sent_at || 'Not sent'}`, `From: ${e.sending_address || ''}`,
      `To: ${e.to_recipients || ''}`, `CC: ${e.cc_recipients || ''}`, `Delivery: ${e.delivery_status}`, `Expiry: ${e.expires_at || ''}`, `Revoked: ${e.revoked_at || ''}`, '', e.body || ''].join('\n') });

  const sales = [], history = [], payments = [], terms = [];
  for (const unit of units) {
    const attempts = data.unit_sale_attempts.filter(a => a.unit_id === unit.id).sort((a, b) => Number(b.attempt_number) - Number(a.attempt_number));
    const active = attempts.find(a => truth(a.is_active));
    const docs = documents.filter(d => d.sale_attempt_id === active?.id && !d.superseded_at);
    const emails = data.sale_legal_emails.filter(e => e.sale_attempt_id === active?.id);
    const currentTerms = data.unit_sale_terms.find(t => t.sale_attempt_id === active?.id && truth(t.is_current));
    const [action, owner] = progression(active, docs, emails, snapshot);
    const authority = emails.filter(e => e.kind === 'authority').sort((a, b) => Number(b.version) - Number(a.version))[0];
    const approval = type => { const d = docs.find(x => x.document_type === type); return d ? completionDocumentApproved(d) ? 'Current version approved' : d.status === 'approved' ? 'Current version awaiting approval' : label(d.status) : 'Not uploaded'; };
    const receipt = data.sale_exchange_deposit_receipts.filter(r => r.sale_attempt_id === active?.id).sort((a, b) => Number(b.revision) - Number(a.revision))[0];
    const row = { ...location(unit.id), unitId: unit.id, saleId: active?.id || '', status: label(unit.sale_status), stage: label(active?.workflow_status || 'Not started'),
      action: ['not_for_sale','not_released'].includes(unit.sale_status) && !active ? 'No active sale' : action, owner,
      buyer: active?.buyer_name || [active?.buyer_person_name, active?.buyer_company_name].filter(Boolean).join(' / '), email: active?.buyer_email, phone: active?.buyer_phone,
      agent: organisation(active?.sales_agent_organisation_id || B.get(unit.building_id)?.sales_agent_organisation_id),
      solicitor: active?.buyer_solicitor_name || organisation(active?.conveyancer_organisation_id || B.get(unit.building_id)?.conveyancer_organisation_id),
      solicitorEmail: active?.buyer_solicitor_email, solicitorPhone: active?.buyer_solicitor_phone,
      price: money(currentTerms?.contract_price), reservation: active?.reservation_date || unit.reservation_date, exchange: active?.exchanged_at,
      authorityExpiry: authority?.expires_at, authorityStatus: authority ? authority.revoked_at ? 'Revoked' : authority.replaced_by ? 'Superseded' : authority.expires_at && Date.parse(authority.expires_at) <= Date.parse(snapshot) ? 'Expired' : label(authority.delivery_status) : 'Not issued',
      notice: active?.completion_notice_issued_at, completionDue: active?.contractual_completion_date,
      statement: approval('completion_statement'), account: approval('draft_statement_of_account'),
      deposit: receipt ? money(receipt.received_amount) : null, depositDate: receipt?.received_date,
      completion: active?.legal_completed_at || active?.completed_at || unit.completion_date,
      handover: unit.handover_date, lastUpdate: active?.updated_at, liveUrl: active ? saleUrl(active.id) : `${portalUrl}/?screen=sales&building=${unit.building_id}&salesUnitId=${unit.id}` };
    sales.push(row);
    if (['for_sale','reserved','exchanged'].includes(unit.sale_status) && row.price == null) exceptions.push({ ...location(unit.id), id: unit.id, issue: 'Sale price not recorded' });
    if (active && ['exchanged','completion_pending'].includes(active.workflow_status) && !receipt) exceptions.push({ ...location(unit.id), id: active.id, issue: 'Exchange deposit receipt not recorded' });
    if (row.authorityStatus === 'Expired' && !active?.exchanged_at) exceptions.push({ ...location(unit.id), id: active.id, issue: 'Exchange authority expired' });
    if (row.completionDue && row.completionDue < snapshot.slice(0,10) && !row.completion) exceptions.push({ ...location(unit.id), id: active.id, issue: 'Contractual completion date has passed' });
    for (const a of attempts) history.push({ ...location(unit.id), id: a.id, kind: 'Sale attempt', date: a.updated_at, actor: person(a.updated_by_user_id),
      description: `Attempt ${a.attempt_number}: ${label(a.workflow_status)}${truth(a.is_active) ? ' (active)' : ' (historical)'}. ${a.fall_through_reason || ''}`, liveUrl: saleUrl(a.id) });
  }
  for (const t of data.unit_sale_terms) terms.push({ ...saleLocation(t.sale_attempt_id), id: t.id, version: number(t.version_number), current: truth(t.is_current), status: label(t.status),
    price: money(t.contract_price), reservationFee: money(t.reservation_fee), holder: label(t.reservation_fee_holder), parking: money(t.parking_value),
    developerContribution: contribution(t, 'developer_contribution'), agentContribution: contribution(t, 'agent_contribution'),
    otherConcessions: money(t.other_concessions), agentFeePercent: number(t.agent_fee_percent) == null ? null : number(t.agent_fee_percent)/100,
    solicitorFee: money(t.solicitor_fee), summary: t.commercial_summary, schedule: t.deposit_summary, specialTerms: t.additional_special_conditions,
    approvedBy: person(t.approved_by_user_id), approvedAt: t.approved_at });
  for (const p of data.unit_sale_payment_schedule) {
    const terms = data.unit_sale_terms.find(t=>t.id===p.sale_terms_id);
    payments.push({ ...saleLocation(p.sale_attempt_id), id: p.id, kind: 'Payment schedule', reference: p.label, status: label(p.status),
      expected: money(p.expected_amount), received: null, date: p.due_date, notes: [terms ? `Terms version ${terms.version_number} (${truth(terms.is_current)?'current':'historical'})` : 'Terms version unavailable',
        p.due_event, p.due_offset_days ? `Offset ${p.due_offset_days} days` : '', truth(p.includes_reservation_fee)?'Includes reservation fee':'', p.notes].filter(Boolean).join('; ') });
  }
  for (const invoice of data.unit_sale_invoices) {
    const paid = data.unit_sale_invoice_payments.filter(p => p.invoice_id === invoice.id && !p.voided_at).reduce((sum, p) => sum + number(p.amount), 0);
    const expected = money(invoice.expected_payable_amount);
    payments.push({ ...saleLocation(invoice.sale_attempt_id), id: invoice.id, kind: `${label(invoice.fee_milestone)} agent invoice`, reference: invoice.invoice_reference, status: label(invoice.status),
      expected, received: paid, balance: expected == null ? null : Math.round((expected-paid)*100)/100, date: invoice.invoice_date, organisation: organisation(invoice.supplier_organisation_id), notes: invoice.query_note });
  }
  for (const p of data.unit_sale_invoice_payments) payments.push({ ...saleLocation(p.sale_attempt_id), id: p.id, kind: 'Invoice payment', reference: p.client_reference || p.invoice_id,
    status: p.voided_at ? 'Voided (excluded from invoice paid total)' : 'Recorded', received: money(p.amount), date: p.paid_at, actor: p.recorded_by_name || person(p.recorded_by_user_id),
    organisation: p.recorded_by_organisation_name || organisation(p.paid_by_organisation_id), notes: [label(p.payment_source), p.notes, p.void_reason].filter(Boolean).join('; ') });
  const replacedReceipts = new Set(data.sale_exchange_deposit_receipts.map(r => r.supersedes_id));
  for (const s of data.sale_exchange_deposit_sources) payments.push({ ...saleLocation(s.sale_attempt_id), id: s.id, kind: 'Locked exchange deposit expectation',
    reference: s.authority_id ? `Authority version ${s.authority_version}` : `Terms version ${s.terms_version ?? 'unknown'}`,
    status: s.expected_amount == null ? 'Expected amount unavailable' : 'Expected amount (not a receipt)', expected: money(s.expected_amount),
    date: s.captured_at, notes: label(s.source_kind) });
  for (const r of data.sale_exchange_deposit_receipts) payments.push({ ...saleLocation(r.sale_attempt_id), id: r.id, kind: 'Exchange deposit confirmation', reference: `Revision ${r.revision}`,
    status: replacedReceipts.has(r.id) ? 'Superseded confirmation (not another payment)' : 'Current confirmation', expected: money(r.expected_amount), received: money(r.received_amount),
    date: r.received_date, actor: r.recorded_by_name || person(r.recorded_by), notes: r.correction_reason });
  for (const [table, kind, body, actor] of [['sale_comments','Sales comment','body','author_id'], ['unit_sale_notes','Sales note','body','created_by_user_id'], ['unit_sale_workflow_events','Sales activity','summary','created_by_user_id']]) {
    for (const e of data[table].filter(e => !e.redacted_at)) {
      const metadata=json(e.metadata), versions=[metadata.versionId,...(metadata.documents||[]).map(d=>d.versionId)].filter(Boolean);
      history.push({ ...saleLocation(e.sale_attempt_id), id: e.id, kind, date: e.created_at, actor: e.author_name || e.actor_name || person(e[actor]),
        description:[...new Set([e[body] || e.note || e.content,metadata.reason,metadata.rejectionReason,metadata.queryNote,versions.length?`Document version IDs: ${versions.join(', ')}`:''].filter(Boolean))].join('\n'), liveUrl: saleUrl(e.sale_attempt_id) });
    }
  }
  const snags = [...data.snags].sort((a,b) => (unitOrder.get(a.unit_id) ?? 1e9)-(unitOrder.get(b.unit_id) ?? 1e9) || String(a.created_at).localeCompare(String(b.created_at))).map(s => {
    const events = [...data.snag_events.filter(e => e.snag_id === s.id), ...data.snag_comments.filter(e => e.snag_id === s.id).map(e=>({...e,comment:e.body}))].sort(byDate);
    const overdue = s.status !== 'closed' && s.sla_due_date && s.sla_due_date.slice(0,10) < snapshot.slice(0,10);
    if (overdue) exceptions.push({ ...location(s.unit_id,s.building_id,s.area_id), id:s.id, issue:'Snag deadline has passed' });
    return { ...location(s.unit_id,s.building_id,s.area_id), id:s.id, title:s.title, description:s.description, trade:T.get(s.trade_id)?.name || '', priority:s.priority_code,
      status:label(s.status), action: ({ closed:'No further action', resolved_by_contractor:'Developer to review resolution', needs_more_info:'Provide requested information', rejected_back_to_contractor:'Contractor to address rejection', in_progress:'Complete work and provide evidence' })[s.status] || (s.assigned_to_organisation_id || s.assigned_to_user_id ? 'Arrange work and provide evidence' : 'Assign responsibility and arrange work'),
      contractor:organisation(s.assigned_to_organisation_id), owner:person(s.assigned_to_user_id), due:s.sla_due_date, overdue:overdue?'Overdue':'',
      created:s.created_at, updated:s.updated_at, closed:s.closed_at, latest:events[0]?.comment || label(events[0]?.event_type), source:label(s.source_type),
      liveUrl:`${portalUrl}/?screen=snags&building=${s.building_id || ''}` };
  });
  for (const e of data.snag_events) { const s = snagIndex.get(e.snag_id); history.push({ ...location(s?.unit_id,s?.building_id,s?.area_id), id:e.snag_id,
    kind:label(e.event_type), date:e.created_at, actor:e.actor_name || person(e.created_by_user_id), description:[e.comment,e.old_value && `From: ${e.old_value}`,e.new_value && `To: ${e.new_value}`].filter(Boolean).join('\n') }); }
  for (const e of data.snag_comments) { const s = snagIndex.get(e.snag_id); history.push({ ...location(s?.unit_id,s?.building_id,s?.area_id), id:e.snag_id,
    kind:'Snag comment', date:e.created_at, actor:person(e.user_id), description:e.body }); }
  for (const e of data.sale_comment_revisions) { const current = data.sale_comments.find(c=>c.id===e.comment_id); history.push({ ...saleLocation(e.sale_attempt_id), id:e.comment_id,
    kind:`Previous sales comment (version ${e.version})`, date:e.recorded_at, actor:current?.author_name || person(current?.author_id), description:e.body, liveUrl:saleUrl(e.sale_attempt_id) }); }
  const contacts = data.organisations.map(o => ({ id:o.id, kind:label(o.type), name:o.name, person:o.main_contact_name, email:o.shared_system_email || o.email, phone:o.phone,
    buildings:data.building_organisations.filter(bo => bo.organisation_id===o.id && truth(bo.active)).map(bo => B.get(bo.building_id)?.name).filter(Boolean).join(', ') }));
  for (const p of data.profiles.filter(p => truth(p.active))) contacts.push({ id:p.id,kind:label(p.role), name:person(p.id), organisation:organisation(p.organisation_id), email:p.email,phone:p.phone });
  const handovers = data.handovers.map(h => ({ ...location(h.unit_id), id:h.id, date:h.handover_datetime || h.handover_date, recipient:h.recipient_name, email:h.recipient_email, phone:h.recipient_phone,
    actor:person(h.handover_by_user_id), keys:number(h.number_of_keys), keyDetails:data.handover_key_items.filter(k=>k.handover_id===h.id).map(k=>`${k.key_type}: ${k.quantity}${k.notes?` (${k.notes})`:''}`).join('\n'),
    readings:data.meter_readings.filter(m=>m.handover_id===h.id).map(m=>`${m.meter_type}: ${m.reading_value}; meter ${m.meter_serial_number || ''}; ${m.reading_date || ''}`).join('\n'), notes:h.notes }));
  const reports = data.snag_reports.map(r=>({ ...location(r.unit_id,r.building_id,r.communal_area_id), id:r.id,date:r.created_at,sent:r.sent_at,location:r.location_label,count:number(r.snag_count),
    recipients:data.snag_report_recipients.filter(p=>p.report_id===r.id).map(p=>`${p.name || p.email}: ${p.email} (${p.delivery_status})`).join('\n'),
    snagIds:data.snag_report_items.filter(i=>i.report_id===r.id).map(i=>i.snag_id).join('\n') }));
  return { snapshot, projectRef, portalUrl, environment:projectRef==='zxgezoiazsubopqhqhim'?'production':'validation', sales, terms, payments, snags, history:history.sort((a,b)=>String(b.date ?? '').localeCompare(String(a.date ?? ''))), contacts, handovers, reports, references, exceptions,
    counts:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,v.length])) };
}
