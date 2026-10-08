import { buildingAllowsFlatHandover, closingNoticeStartDate, hasPassedExpectedPcWarning, initialDefectsReportingEndDate } from "../building-lifecycle";
import { sortUnitsByBuildingFloorOrder, saleStatusLabel } from "../units/commercial-allocation";
import { canPerformSalesAction, isSalesInternalRole, type SalesStageAction } from "../sales/permissions";
import { exchangeAuthorityState } from "../sales/authority-state";
import { completionDocumentApproved, completionDocumentsApproved, completionDocumentLabels, completionDocumentTypes, currentCompletionVersion } from "../sales/completion-review";
import { completionNoticeState } from "../sales/completion-notice";
import { deriveAgentFeePortfolioRow } from "../sales/agent-fees-portfolio";
import { activeTenancy, currentVoidDays, tenancyEndingWithinDays } from "../rentals/tenancies";
import { deriveTenancyRentRisk } from "../rentals/rent-risk";
import { calendarDays, deadlineState, londonDate, recentBusinessWindow } from "./dates";
import { currentInformationSupplied, isActiveSnag, latestStatusTransition, needsTrade } from "./snags";
import type { DashboardInput, DashboardSnapshot, PortfolioSummary, WorkContext, WorkItem, WorkParty } from "./types";

export function dashboardRoleAllowed(role: string) {
  return ["admin", "developer", "developer_representative", "contractor", "sales_agent", "conveyancer"].includes(role);
}

export { destinationUrl, groupWorkItems, filterWork } from "./presentation";

/** Responsibility never grants visibility. Inputs have already passed server/RLS access checks. */
export function deriveDashboard(input: DashboardInput): DashboardSnapshot {
  const { viewer, now } = input;
  const internal = isSalesInternalRole(viewer.role);
  const operational = internal || viewer.role === "developer_representative";
  const today = londonDate(now);
  const buildings = input.buildings.filter(b => !input.buildingId || b.id === input.buildingId);
  const buildingMap = new Map(buildings.map(b => [b.id, b]));
  const units = sortUnitsByBuildingFloorOrder(input.units.filter(u => buildingMap.has(u.building_id)), input.floors, buildings);
  const unitMap = new Map(units.map(u => [u.id, u]));
  const unitOrder = new Map(units.map((u, index) => [u.id, index]));
  const available = (key: string) => input.sources.find(source => source.key === key)?.state === "ready";
  const orgName = (id: string | null) => input.organisations.find(o => o.id === id)?.name;
  const relationshipOrg = (buildingId: string, role: string) => {
    const ids = [...new Set(input.buildingOrganisations.filter(link => link.building_id === buildingId && link.role_on_project === role && link.active !== false).map(link => link.organisation_id))];
    return ids.length === 1 ? ids[0] : null;
  };
  const party = (kind: WorkParty["kind"], id: string | null = null): WorkParty => ({
    kind, organisationId: id, label: kind === "developer" ? "Developer team" : orgName(id) ?? ({ sales_agent: "Sales agent — organisation unallocated", conveyancer: "Conveyancer — organisation unallocated", contractor: "Contractor — organisation unallocated", unallocated: "Responsible organisation unallocated" }[kind]),
  });
  const owns = (p: WorkParty) => p.kind === "developer" ? operational
    : Boolean(p.organisationId && p.organisationId === viewer.organisation_id && p.kind === viewer.role);
  const items: WorkItem[] = [];
  let approvedFeeBalance = 0;
  const activity: DashboardSnapshot["activity"] = [];
  const add = (base: Pick<WorkItem, "recordKey" | "module" | "source" | "buildingId" | "unitId" | "reference" | "position" | "destination">,
    kind: string, action: string, responsibility: WorkParty, since: string | null, basis: string,
    options: Partial<Omit<WorkItem, keyof typeof base | "kind" | "action" | "responsibility">> = {}) => {
    const cycle = options.cycleId ?? since ?? "current";
    items.push({ ...base, id: `${base.recordKey}:${kind}:${cycle}`, kind, action, responsibility, ours: owns(responsibility), canAct: owns(responsibility),
      waiting: { since, basis, fallback: false, precision: since?.length === 10 ? "date" : "instant" }, deadline: null, urgent: false, cycleId: cycle, context: null, countingUnit: "task", ...options });
  };

  for (const sale of input.sales.filter(s => buildingMap.has(s.building_id) && s.is_active && !s.redacted_at && !["fallen_through", "superseded", "failed", "withdrawn"].includes(s.workflow_status))) {
    const unit = unitMap.get(sale.unit_id);
    if (!unit) continue;
    const events = input.saleEvents.filter(e => e.sale_attempt_id === sale.id).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    const contextFor = (event = events[0]): WorkContext | null => event ? { id: event.id, text: event.summary ?? event.event_type.replaceAll("_", " "), at: event.created_at, account: event.created_by_user_id ? event.actor_name ?? "Unknown account" : null } : null;
    const saleDocs = input.documents.filter(d => d.sale_attempt_id === sale.id);
    const documentPosition = saleDocs.filter(d => completionDocumentTypes.some(type => type === d.document_type)).map(d => `${d.document_type === "completion_statement" ? "Statement" : "Account"}: ${completionDocumentApproved(d) ? "approved" : d.status === "query_raised" ? "queried" : "awaiting approval"}`).join("; ");
    const base = { recordKey: `sale:${sale.id}`, module: "sales" as const, source: "Sale", buildingId: sale.building_id, unitId: unit.id, reference: `Unit ${unit.unit_number}`, position: `${saleStatusLabel(unit.sale_status)}${documentPosition ? ` · ${documentPosition}` : ""}`, destination: { screen: "sales" as const, buildingId: sale.building_id, unitId: unit.id, saleId: sale.id } };
    const developer = party("developer");
    // Correspondence routing contacts are deliberately not assignment fallbacks.
    const agent = party("sales_agent", sale.sales_agent_organisation_id ?? relationshipOrg(sale.building_id, "sales_agent"));
    const conveyancer = party("conveyancer", sale.conveyancer_organisation_id ?? relationshipOrg(sale.building_id, "conveyancer"));
    const task = (kind: string, label: string, responsible: WorkParty, since: string | null, basis: string, permission: SalesStageAction, anchor: string, options: Partial<WorkItem> = {}) =>
      add({ ...base, destination: { ...base.destination, anchor, section: anchor.includes("fee") ? "financials" : "progression", ...options.destination } }, kind, label, responsible, since, basis,
        { context: contextFor(), canAct: canPerformSalesAction(viewer.role, permission), ...options });
    const completed = Boolean(sale.completed_at || sale.legal_completed_at || sale.workflow_status === "completed");
    const exchanged = Boolean(sale.exchanged_at || completed);
    const approved = Boolean(sale.reservation_approved_at || ["approved", "reservation_approved", "ready_for_exchange", "awaiting_commercial_approval", "exchanged", "completion_pending", "completed"].includes(sale.workflow_status));
    if (available("sales") && !completed) {
      if (["reservation_submitted", "awaiting_approval"].includes(sale.workflow_status)) task("reservation_review", "Review submitted reservation", developer, sale.reservation_submitted_at, "Reservation submitted", "approve_reservation", "sales-stage-reservation");
      if (["reservation_rejected", "reservation_query_raised", "rejected"].includes(sale.workflow_status)) task("reservation_correct", "Correct and resubmit reservation", agent, sale.reservation_rejected_at, "Reservation returned", "submit_reservation", "sales-stage-reservation", {
        context: sale.reservation_rejection_reason ? { id: `${sale.id}:return`, text: sale.reservation_rejection_reason, at: sale.reservation_rejected_at ?? "", account: contextFor(events.find(e => /reservation_(rejected|query_raised)/.test(e.event_type)))?.account ?? null } : contextFor(),
      });
      if (approved && !sale.commercial_approved_at && !["ready_for_exchange", "exchanged", "completion_pending"].includes(sale.workflow_status) && !exchanged)
        task("commercial_review", "Approve commercial terms", developer, sale.reservation_approved_at, "Reservation approved", "approve_commercial_package", "sales-stage-exchange");
      if (available("legal") && approved && !exchanged) {
        const authority = exchangeAuthorityState(input.authorities.filter(e => e.sale_attempt_id === sale.id), events, sale.authority_requested_at, exchanged, now);
        const current = authority.current;
        if (authority.pending) task("authority_request", authority.renewal ? "Review request to renew exchange authority" : "Review request for exchange authority", developer, authority.requestDate, "Current authority request", "approve_exchange", "sales-stage-exchange");
        if (current && !current.replaced_by && !current.revoked_at && (!current.expires_at || Date.parse(current.expires_at) > now)) {
          if (authority.issued) task("exchange_progress", "Progress exchange and record it when legally completed", conveyancer, current.issued_at, "Current exchange authority issued", "record_exchange", "sales-stage-exchange", {
            cycleId: current.id, deadline: current.expires_at ? { at: current.expires_at, precision: "instant", basis: "Exchange authority expires (London time)" } : null,
          });
        } else if (authority.canRequest) task("authority_follow_up", current ? "Request renewed exchange authority" : "Request exchange authority when ready", conveyancer, current?.revoked_at ?? current?.expires_at ?? sale.commercial_approved_at, current ? "Current authority invalidated" : "Commercial approval", "request_exchange_approval", "sales-stage-exchange", { cycleId: current?.id ?? null });
      }
      if (exchanged && available("legal")) {
        const notice = completionNoticeState(sale);
        if (sale.completion_authority_requested_at && !notice.authorised) task("notice_authority", "Review authority to serve notice request", developer, sale.completion_authority_requested_at, "Authority to serve notice requested", "approve_exchange", "notice-authority-step");
        if (!notice.authorised && !sale.completion_authority_requested_at) task("notice_request", "Request authority to serve notice when ready", conveyancer, sale.exchanged_at, "Exchange date", "request_exchange_approval", "notice-authority-step");
        if (notice.authorised && !notice.confirmed) {
          const missing = [!sale.completion_notice_issued_at && "notice issue date", !sale.contractual_completion_date && "saved contractual due date", !saleDocs.some(d => d.document_type === "completion_correspondence" && currentCompletionVersion(d)) && "notice PDF"].filter(Boolean);
          task("notice_arrangements", `Confirm notice arrangements${missing.length ? `: ${missing.join(", ")}` : ""}`, conveyancer, sale.completion_authority_given_at, "Authority to serve notice given", "confirm_completion_arrangements", "completion-arrangements-step");
        }
        const completionUnitEligible = ["exchanged", "completed"].includes(unit.sale_status);
        if (!completionUnitEligible) task("sale_unit_reconciliation", "Reconcile the sale and unit stages before legal completion", developer, null, "Exchanged sale has an incompatible unit stage", "record_completion", "completion-legal-step", { canAct: false });
        if (notice.confirmed && !sale.contractual_completion_date) task("notice_dates", "Confirm the missing saved contractual completion date", conveyancer, null, "Required saved date is missing", "confirm_completion_arrangements", "completion-arrangements-step");
        if (notice.confirmed) {
          for (const type of completionDocumentTypes) {
            const document = saleDocs.find(d => d.document_type === type);
            const version = currentCompletionVersion(document);
            const label = completionDocumentLabels[type].toLowerCase();
            if (!version) task(`missing_${type}`, `Upload ${label}`, conveyancer, sale.completion_arrangements_confirmed_at, "Completion arrangements confirmed", "submit_completion_documents", "completion-documents-step", { countingUnit: "document" });
            else if (!completionDocumentApproved(document)) {
              const queried = document?.status === "query_raised";
              const queryEvent = events.find(e => e.event_type === "completion_documents_query_raised" && (e.version_id ?? e.metadata?.versionId) === version.id);
              task(`${queried ? "replace" : "review"}_${type}`, `${queried ? "Replace queried" : "Review"} ${label}`, queried ? conveyancer : developer,
                queried ? queryEvent?.created_at ?? document?.updated_at ?? null : version.uploaded_at, queried ? "Current document query" : "Current version uploaded", queried ? "submit_completion_documents" : "approve_completion_documents", "completion-documents-step", {
                  countingUnit: "document", cycleId: version.id, context: queried && document?.query_note ? { id: queryEvent?.id ?? version.id, text: document.query_note, at: queryEvent?.created_at ?? document.updated_at, account: queryEvent?.actor_name ?? input.saleActors?.find(actor => actor.id === document.updated_by_user_id)?.display_name ?? null } : contextFor(),
                  destination: { ...base.destination, section: "progression", anchor: "completion-documents-step", versionId: version.id },
                });
            }
          }
          if (completionUnitEligible && sale.exchanged_at && sale.contractual_completion_date && completionDocumentsApproved(saleDocs)) task("legal_completion", "Portal checks complete, awaiting legal completion confirmation", conveyancer,
            saleDocs.filter(d => completionDocumentTypes.some(t => t === d.document_type)).map(d => d.approved_at).filter((at): at is string => Boolean(at)).sort().at(-1) ?? null,
            "Both current documents approved", "record_completion", "completion-legal-step");
        }
        if (sale.contractual_completion_date && calendarDays(today, sale.contractual_completion_date) <= 30) task("completion_date", "Review saved contractual completion date", conveyancer, sale.completion_arrangements_confirmed_at, "Completion arrangements confirmed", "record_completion", "completion-arrangements-step", {
          deadline: { at: sale.contractual_completion_date, precision: "date", basis: "Saved contractual completion date" },
        });
      }
    }
    if (exchanged && available("legal")) {
      const source = input.depositSources.find(d => d.sale_attempt_id === sale.id);
      const receipt = input.deposits.some(d => d.sale_attempt_id === sale.id && d.source_id === source?.id && Number(d.expected_amount) === Number(source.expected_amount) && Number(d.received_amount) === Number(source.expected_amount));
      if (!receipt) task("deposit_receipt", source?.expected_amount == null ? "Review unavailable deposit confirmation basis" : "Confirm receipt of the full expected exchange deposit", conveyancer, sale.exchanged_at, "Exchange date — record-keeping exception", "confirm_exchange_deposit", "exchange-deposit-task");
    }
    if (available("legal")) for (const email of input.authorities.filter(e => e.sale_attempt_id === sale.id && !e.replaced_by && !e.revoked_at && ["failed", "bounced", "complained", "delivery_delayed"].includes(e.delivery_status))) {
      task(`legal_delivery_${email.kind}`, `Review legal email: ${email.delivery_status.replaceAll("_", " ")}`, developer, email.issued_at, "Email issued; provider check time not recorded", "approve_exchange", "sales-stage-exchange", { cycleId: email.id });
    }
    if (available("fees") && internal) {
      const terms = input.terms.find(t => t.sale_attempt_id === sale.id);
      const invoiceFor = (milestone: string) => input.invoices.filter(i => i.sale_attempt_id === sale.id && i.fee_milestone === milestone && !["superseded", "void", "voided"].includes(i.status)).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      const exchangeInvoice = invoiceFor("exchange"), completionInvoice = invoiceFor("completion");
      const position = deriveAgentFeePortfolioRow({ saleAttemptId: sale.id, buildingId: sale.building_id, buildingName: buildingMap.get(sale.building_id)!.name, unitId: unit.id, unitNumber: unit.unit_number, unitSaleStatus: unit.sale_status, workflowStatus: sale.workflow_status,
        salePrice: terms?.contract_price, exchangeFeePercent: terms?.exchange_agent_fee_percent, completionFeePercent: terms?.completion_agent_fee_percent, vatRate: terms?.vat_rate,
        exchangeInvoice, completionInvoice, exchangePayments: input.payments.filter(p => p.invoice_id === exchangeInvoice?.id), completionPayments: input.payments.filter(p => p.invoice_id === completionInvoice?.id) });
      for (const milestone of ["exchange", "completion"] as const) {
        const state = position[milestone], invoice = invoiceFor(milestone);
        if (["approved_unpaid", "part_paid"].includes(state.kind)) approvedFeeBalance += Math.round(state.outstandingBalance * 100);
        if (!state.needsAction) continue;
        const submit = ["rejected", "not_submitted", "invoice_required"].includes(state.kind);
        const label = state.kind === "awaiting_approval" ? `Review ${milestone} agent invoice` : state.kind === "rejected" ? `Replace queried ${milestone} agent invoice` : submit ? `Submit ${milestone} agent invoice` : `Record payment against ${milestone} approved invoice`;
        task(`fee_${milestone}_${state.kind}`, label, submit ? agent : developer, invoice?.approved_at ?? invoice?.created_at ?? (milestone === "completion" ? sale.exchanged_at : sale.reservation_approved_at), invoice?.approved_at ? "Invoice approved — no payment due date recorded" : invoice ? "Invoice submitted" : "Invoice milestone eligible", submit ? "submit_agent_invoice" : state.kind === "awaiting_approval" ? "approve_agent_invoice" : "record_agent_fee_payment", `${milestone}-fee`, { cycleId: invoice?.id ?? null, countingUnit: "invoice" });
      }
    }
    const window = recentBusinessWindow(now);
    for (const event of events.filter(e => Date.parse(e.created_at) >= window.start && Date.parse(e.created_at) < window.end && /^(reservation_|authority_|exchange_recorded|completion_|agent_invoice_|agent_fee_)/.test(e.event_type))) {
      activity.push({ ...contextFor(event)!, recordKey: base.recordKey, destination: { ...base.destination, section: "activity" } });
    }
  }

  if (available("snags")) for (const snag of input.snags.filter(s => s.building_id && buildingMap.has(s.building_id) && isActiveSnag(s))) {
    const buildingId = snag.building_id!;
    const unit = snag.unit_id ? unitMap.get(snag.unit_id) : null;
    const transition = latestStatusTransition(snag.snag_events, snag.id);
    const currentTransition = transition?.new_value === snag.status ? transition : null;
    const info = currentInformationSupplied(snag, snag.snag_events);
    const base = { recordKey: `snag:${snag.id}`, module: "snags" as const, source: snag.source_type === "leaseholder_defect" ? "Resident defect" : "Developer snag", buildingId, unitId: snag.unit_id, reference: `${unit ? `Unit ${unit.unit_number}` : "Communal"} · ${snag.title}`, position: snag.status.replaceAll("_", " "), destination: { screen: "snags" as const, buildingId, snagId: snag.id, source: snag.source_type } };
    const triage = snag.source_type === "leaseholder_defect" && (["new", "submitted"].includes(snag.status) || (snag.status === "open" && !snag.priority_code));
    const developerTurn = ["resolved_by_contractor", "needs_more_info"].includes(snag.status) || triage;
    const contractorId = snag.assigned_to_organisation_id ?? relationshipOrg(buildingId, "main_contractor");
    const mainContractorId = relationshipOrg(buildingId, "main_contractor");
    const externalWorkflow = Boolean(mainContractorId && snag.assigned_to_organisation_id && snag.assigned_to_organisation_id !== mainContractorId);
    const responsible = developerTurn ? party("developer") : contractorId ? party("contractor", contractorId) : party("unallocated");
    const label = snag.status === "resolved_by_contractor" ? "Review contractor resolution" : snag.status === "needs_more_info" ? "Supply requested information" : snag.status === "rejected_back_to_contractor" ? "Address developer rejection" : info ? "Continue work with supplied information" : triage ? "Triage resident defect" : "Progress outstanding work";
    add(base, info ? "information_supplied" : "progress", label, responsible, currentTransition?.created_at ?? null, currentTransition ? "Current status transition" : "Current cycle time unavailable", {
      cycleId: currentTransition?.id ?? snag.id,
      canAct: developerTurn || externalWorkflow && snag.status === "open" ? operational : viewer.role === "contractor" && !externalWorkflow && owns(responsible),
      context: currentTransition ? { id: currentTransition.id, text: currentTransition.comment ?? label, at: currentTransition.created_at, account: currentTransition.created_by_user_id ? "Recorded account (see history)" : null } : null,
      deadline: snag.source_type === "leaseholder_defect" && snag.sla_due_date ? { at: snag.sla_due_date, precision: snag.sla_due_date.length === 10 ? "date" : "instant", basis: "Recorded defect SLA" } : null,
      urgent: snag.source_type === "leaseholder_defect" && snag.priority_code === "P1",
      waiting: currentTransition ? { since: currentTransition.created_at, basis: "Current status transition", fallback: false, precision: "instant" } : { since: snag.created_at, basis: "Raised on — current cycle time unknown", fallback: true, precision: "instant" },
    });
    if (needsTrade(snag) && operational) add(base, "missing_trade", "Allocate missing trade", party("developer"), null, "Allocation age unavailable");
    // A missing organisation has no automatic contractor owner. Allocation remains developer work.
    if (!contractorId && operational && snag.source_type === "developer_snag") add(base, "missing_organisation", "Review unallocated responsible organisation", party("developer"), null, "Neither an assigned organisation nor a unique main contractor is configured");
  }

  if (available("handovers")) for (const unit of units.filter(u => u.sale_status === "completed" && !u.handover_date && !input.handovers.some(h => h.unit_id === u.id))) {
    const eligible = buildingAllowsFlatHandover(buildingMap.get(unit.building_id), today);
    if (!eligible) continue;
    add({ recordKey: `unit:${unit.id}`, module: "other", source: "Handover", buildingId: unit.building_id, unitId: unit.id, reference: `Unit ${unit.unit_number}`, position: "Completed; PC eligible", destination: { screen: "units", buildingId: unit.building_id, unitId: unit.id, anchor: "handover" } }, "handover", "Arrange handover", party("developer"), unit.completion_date, "Saved completion date", { canAct: internal, countingUnit: "unit" });
  }
  if (available("rentals") && internal) for (const unit of units.filter(u => u.rental_portfolio_status === "active")) {
    const tenancies = input.tenancies.filter(t => t.unit_id === unit.id);
    const tenancy = activeTenancy(tenancies, today);
    const base = { recordKey: `rental:${unit.id}`, module: "other" as const, source: "Rental", buildingId: unit.building_id, unitId: unit.id, reference: `Unit ${unit.unit_number}`, position: tenancy ? "Occupied" : "Void", destination: { screen: "rentals" as const, buildingId: unit.building_id, unitId: unit.id } };
    if (!tenancy) {
      const previousEnd = tenancies.map(t => t.tenancy_end_date).filter((d): d is string => Boolean(d && d < today)).sort().at(-1) ?? null;
      const days = currentVoidDays(previousEnd, today);
      add(base, "rental_void", "Follow up current void", party("developer"), previousEnd, days === null ? "No previous tenancy end recorded; void duration unknown" : "Previous tenancy ended", { countingUnit: "unit" });
    } else {
      if (tenancyEndingWithinDays(tenancy, 30, today)) add(base, "fixed_term", "Review approaching fixed-term date; tenancy continues until ended", party("developer"), null, "Review window; no task start recorded", { cycleId: tenancy.id, deadline: { at: tenancy.fixed_term_end_date!, precision: "date", basis: "Fixed-term review date" } });
      if (available("rent_risk")) {
        const risk = deriveTenancyRentRisk(tenancy.id, input.arrears, today);
        if (risk.interventionLevel === "action_required" || risk.reconciliationRequired) {
          const episodes = input.arrears.filter(e => e.tenancy_id === tenancy.id && (e.status === "open" || ["ended_unreconciled", "closed_reconciliation_review"].includes(e.status)));
          for (const episode of episodes) add(base, "rent_risk", risk.reconciliationRequired ? "Reconcile current-tenancy reported arrears evidence" : "Review current-tenancy reported arrears action", party("developer"), episode.first_reported_at, "Episode first reported", { countingUnit: "episode", cycleId: episode.id, context: { id: episode.id, text: `${episode.management_summary} · Reported through ${episode.last_reported_at.slice(0, 10)}`, at: episode.last_reported_at, account: null } });
        }
      }
    }
  }
  if (available("access") && viewer.role === "admin") for (const request of input.accessRequests.filter(r => !input.buildingId || r.requested_units.some(u => u.building_id === input.buildingId))) {
    add({ recordKey: `access:${request.id}`, module: "other", source: "Resident access", buildingId: input.buildingId || request.requested_units[0]?.building_id || "", unitId: null, reference: "Resident access request", position: "Pending review", destination: { screen: "setup_people", buildingId: input.buildingId, requestId: request.id } }, "resident_access", "Review access and existing-account checks", party("developer"), request.created_at, "Access requested", { countingUnit: "request" });
  }
  if (internal && available("rent_risk")) for (const building of buildings) {
    const latest = input.rentalImports.filter(r => r.building_id === building.id).sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
    if (!latest && units.some(u => u.building_id === building.id && u.rental_portfolio_status === "active")) add({ recordKey: `rental-source:${building.id}`, module: "other", source: "Rental source", buildingId: building.id, unitId: null, reference: building.name, position: "No rental import evidence is recorded", destination: { screen: "rentals", buildingId: building.id } }, "rental_evidence", "Check reported rent evidence before treating the portfolio as clear", party("developer"), null, "Source data-through date unavailable");
    if (latest && (latest.status === "failed" || latest.error_count > 0 || latest.data_quality_issue_count > 0)) add({ recordKey: `import:${latest.id}`, module: "other", source: "Rental import", buildingId: building.id, unitId: null, reference: building.name, position: `Latest import ${latest.status}; evidence through ${latest.data_as_of ?? "unknown"}`, destination: { screen: "rentals", buildingId: building.id } }, "rental_import", "Review rental source exceptions", party("developer"), latest.completed_at ?? latest.started_at, "Latest import result; dashboard refresh does not update source evidence");
  }
  if (operational) for (const building of buildings) {
    const base = { recordKey: `building:${building.id}`, module: "other" as const, source: "Building lifecycle", buildingId: building.id, unitId: null, reference: building.name, position: "Lifecycle review", destination: viewer.role === "admin" ? { screen: "setup_buildings" as const, buildingId: building.id } : null };
    if (hasPassedExpectedPcWarning(building, today)) add(base, "pc_confirmation", "Expected PC date passed; confirmation required", party("developer"), building.pc_date ?? building.practical_completion_date, "Expected PC date", { canAct: viewer.role === "admin" });
    const end = initialDefectsReportingEndDate(building), closing = closingNoticeStartDate(building);
    if (end && closing && today >= closing && today <= end) add(base, "reporting_closure", "Review open work before the initial defects reporting period closes", party("developer"), closing, "Reporting closure window", { canAct: viewer.role === "admin", deadline: { at: end, precision: "date", basis: "Initial defects reporting period closes; existing rights and unresolved work remain" } });
  }

  const summaries: PortfolioSummary[] = [];
  const summary = (key: string, label: string, value: number, unit: string, module: PortfolioSummary["module"], source: string, detail?: string) => summaries.push({ key, label, value: available(source) ? value : null, unit, module, detail: available(source) ? detail : "Source unavailable; refresh to retry." });
  if (internal || ["sales_agent", "conveyancer"].includes(viewer.role)) for (const status of ["for_sale", "reserved", "exchanged", "completed", "handed_over", "not_released", "not_for_sale"] as const) summary(status, saleStatusLabel(status), units.filter(u => u.sale_status === status).length, "units", "sales", "sales");
  if (internal || ["developer_representative", "contractor"].includes(viewer.role)) {
    summary("developer_snags", "Active developer snags", input.snags.filter(s => s.source_type === "developer_snag" && isActiveSnag(s)).length, "snags", "snags", "snags");
    summary("resident_defects", "Active resident defects", input.snags.filter(s => s.source_type === "leaseholder_defect" && isActiveSnag(s)).length, "defects", "snags", "snags");
    if (operational) summary("handover", "Eligible handovers", items.filter(i => i.kind === "handover").length, "units", "other", "handovers");
  }
  if (internal) {
    const rentalUnits = units.filter(u => u.rental_portfolio_status === "active");
    summary("rentals", "Active rentals", rentalUnits.length, "units", "other", "rentals", "Sales and rentals may overlap.");
    summary("occupied", "Occupied rentals", rentalUnits.filter(u => activeTenancy(input.tenancies.filter(t => t.unit_id === u.id), today)).length, "units", "other", "rentals");
    summary("voids", "Current voids", items.filter(i => i.kind === "rental_void").length, "units", "other", "rentals");
    summary("document_reviews", "Completion reviews", items.filter(i => i.kind.startsWith("review_")).length, "documents", "sales", "legal", `${new Set(items.filter(i => i.kind.startsWith("review_")).map(i => i.recordKey)).size} affected sale files`);
    summary("approved_fees", "Approved unpaid agent invoices", items.filter(i => /fee_.*_(approved_unpaid|part_paid)$/.test(i.kind)).length, "invoices", "sales", "fees", `${new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(approvedFeeBalance / 100)} approved cash balance including VAT and recorded deductions. No assumed payment deadline.`);
    const importDates = buildings.map(b => input.rentalImports.filter(r => r.building_id === b.id && r.status === "succeeded" && r.data_as_of).sort((a, b) => b.started_at.localeCompare(a.started_at))[0]?.data_as_of).filter((at): at is string => Boolean(at)).sort();
    summary("reported_arrears", "Current-tenancy arrears actions", items.filter(i => i.kind === "rent_risk").length, "episodes", "other", "rent_risk", `${importDates.length ? `Source evidence dates ${importDates[0]} to ${importDates.at(-1)}.` : "No import evidence date available."} No reported arrears is not proof that rent is paid.`);
    summary("pc_ineligible", "Completed, awaiting PC eligibility", units.filter(u => u.sale_status === "completed" && !buildingAllowsFlatHandover(buildingMap.get(u.building_id), today) && !u.handover_date).length, "units", "other", "handovers", "Lifecycle context; handover is not yet available.");
  }
  const urgency = (item: WorkItem) => item.urgent ? 0 : deadlineState(item.deadline, now) === "overdue" ? 1 : ["today", "soon"].includes(deadlineState(item.deadline, now)) ? 2 : 3;
  items.sort((a, b) => urgency(a) - urgency(b) || (a.deadline && b.deadline ? a.deadline.at.localeCompare(b.deadline.at) : 0)
    || (a.waiting.fallback ? Infinity : Date.parse(a.waiting.since ?? "") || Infinity) - (b.waiting.fallback ? Infinity : Date.parse(b.waiting.since ?? "") || Infinity)
    || (unitOrder.get(a.unitId ?? "") ?? Infinity) - (unitOrder.get(b.unitId ?? "") ?? Infinity) || a.id.localeCompare(b.id));
  return {
    asOf: new Date(now).toISOString(), scope: { buildingId: input.buildingId, label: input.buildingId ? buildingMap.get(input.buildingId)?.name ?? "Unavailable building" : "All accessible buildings", team: operational ? "Developer team" : viewer.organisationName ?? orgName(viewer.organisation_id) ?? "Organisation not recorded", identity: `${viewer.id}:${viewer.role}:${viewer.organisation_id ?? ""}` },
    sources: input.sources, items, summaries,
    activity: [...new Map(activity.sort((a, b) => b.at.localeCompare(a.at)).map(e => [e.id, e])).values()].slice(0, 7),
    buildings: buildings.map(b => ({ id: b.id, name: b.name, sales: available("sales") ? units.filter(u => u.building_id === b.id && ["for_sale", "reserved", "exchanged", "completed", "handed_over"].includes(u.sale_status)).length : null, rentals: available("rentals") ? units.filter(u => u.building_id === b.id && u.rental_portfolio_status === "active").length : null, snags: available("snags") ? input.snags.filter(s => s.building_id === b.id && s.source_type === "developer_snag" && isActiveSnag(s)).length : null, defects: available("snags") ? input.snags.filter(s => s.building_id === b.id && s.source_type === "leaseholder_defect" && isActiveSnag(s)).length : null })),
  };
}
