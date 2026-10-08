export const NOW = Date.parse('2026-10-07T12:00:00Z');
export const building = { id:'10000000-0000-4000-8000-000000000001', name:'Synthetic House', status:'active', pc_date:'2025-01-01', pc_confirmed:true };
export const unit = { id:'20000000-0000-4000-8000-000000000001', building_id:building.id, unit_number:'2', floor:'Ground', sale_status:'exchanged', rental_portfolio_status:'not_in_portfolio', completion_date:null, handover_date:null };
export const sale = { id:'40000000-0000-4000-8000-000000000001', unit_id:unit.id, building_id:building.id, is_active:true, workflow_status:'exchanged', sales_agent_organisation_id:'agent-org', conveyancer_organisation_id:'legal-org', reservation_approved_at:'2026-09-01T12:00:00Z', commercial_approved_at:'2026-09-01T12:00:00Z', exchanged_at:'2026-09-02', completion_arrangements_confirmed_at:'2026-10-01T12:00:00Z', contractual_completion_date:'2026-10-07', created_at:'2026-08-01T12:00:00Z' };
export function fixture(overrides={}) {
  return { now:NOW, viewer:{id:'viewer',role:'developer',organisation_id:'dev-org'}, buildingId:'', buildings:[{...building}], units:[{...unit}], floors:[{building_id:building.id,name:'Ground',sort_order:0}], organisations:[{id:'legal-org',name:'Synthetic Legal Team'},{id:'agent-org',name:'Synthetic Agency'}], buildingOrganisations:[], sales:[{...sale}], documents:[], authorities:[], saleEvents:[], deposits:[], depositSources:[], invoices:[], terms:[], payments:[], snags:[], handovers:[], tenancies:[], arrears:[], rentalImports:[], accessRequests:[], sources:['sales','legal','history','fees','snags','handovers','rentals','rent_risk','access'].map(key=>({key,label:key,state:'ready',asOf:new Date(NOW).toISOString()})), ...overrides };
}
export function document(type,status='uploaded',version=`${type}-v1`) {
  return {id:type,sale_attempt_id:sale.id,document_type:type,status,approved_version_id:status==='approved'?version:null,approved_at:status==='approved'?'2026-10-03T12:00:00Z':null,updated_at:'2026-10-02T12:00:00Z',query_note:status==='query_raised'?'Please correct the statement.':null,unit_sale_document_versions:[{id:version,is_current:true,redacted_at:null,uploaded_at:'2026-10-01T12:00:00Z'}]};
}
export function snag(overrides={}) {
  return {id:'snag-1',building_id:building.id,unit_id:unit.id,source_type:'developer_snag',title:'Synthetic snag',status:'open',trade_id:'trade',assigned_to_organisation_id:'contractor-org',created_at:'2026-08-01T12:00:00Z',snag_events:[],...overrides};
}
