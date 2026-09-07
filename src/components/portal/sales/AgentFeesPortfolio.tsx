"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { formatGbp } from "@/lib/sales/currency";
import {
  deriveAgentFeePortfolioRow,
  filterAgentFeePortfolioRows,
  summariseAgentFeePortfolio,
  type AgentFeePortfolioInput,
  type AgentFeePortfolioInvoice,
  type AgentFeePortfolioInvoiceState,
  type AgentFeePortfolioMilestoneFilter,
  type AgentFeePortfolioRow,
  type AgentFeePortfolioStatusFilter,
} from "@/lib/sales/agent-fees-portfolio";
import type { AgentFeePayment } from "@/lib/sales/agent-fees";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type AgentFeePortfolioRpcRow = {
  sale_attempt_id: string;
  building_id: string;
  building_name: string;
  unit_id: string;
  unit_number: string;
  unit_sale_status: string;
  workflow_status: string;
  sales_agent_organisation_id: string | null;
  sales_agent_name: string | null;
  contract_price: number | null;
  exchange_fee_percent: number | null;
  completion_fee_percent: number | null;
  vat_rate: number | null;
  exchange_invoice: AgentFeePortfolioInvoice | null;
  completion_invoice: AgentFeePortfolioInvoice | null;
  exchange_active_payments: AgentFeePayment[] | null;
  completion_active_payments: AgentFeePayment[] | null;
};

const statusFilters: Array<{ value: AgentFeePortfolioStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "needs_attention", label: "Needs attention" },
  { value: "awaiting_approval", label: "Awaiting approval" },
  { value: "outstanding_payment", label: "Outstanding payment" },
  { value: "invoice_required", label: "Invoice required" },
  { value: "rejected", label: "Rejected" },
  { value: "up_to_date", label: "Up to date" },
  { value: "complete", label: "Complete" },
];

const milestoneFilters: Array<{ value: AgentFeePortfolioMilestoneFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "exchange", label: "Exchange" },
  { value: "completion", label: "Completion" },
];

function mapPortfolioRow(row: AgentFeePortfolioRpcRow): AgentFeePortfolioInput {
  return {
    saleAttemptId: row.sale_attempt_id,
    buildingId: row.building_id,
    buildingName: row.building_name,
    unitId: row.unit_id,
    unitNumber: row.unit_number,
    unitSaleStatus: row.unit_sale_status,
    workflowStatus: row.workflow_status,
    agentOrganisationId: row.sales_agent_organisation_id,
    agentName: row.sales_agent_name,
    salePrice: row.contract_price,
    exchangeFeePercent: row.exchange_fee_percent,
    completionFeePercent: row.completion_fee_percent,
    vatRate: row.vat_rate,
    exchangeInvoice: row.exchange_invoice,
    completionInvoice: row.completion_invoice,
    exchangePayments: row.exchange_active_payments,
    completionPayments: row.completion_active_payments,
  };
}

function invoiceStatusLabel(state: AgentFeePortfolioInvoiceState) {
  if (state.kind === "not_submitted") return "Not submitted";
  if (state.kind === "not_due") return "Not due";
  if (state.kind === "invoice_required") return "Invoice required";
  if (state.kind === "awaiting_approval") return "Awaiting approval";
  if (state.kind === "rejected") return "Rejected";
  if (state.kind === "approved_unpaid") return `Approved · ${formatGbp(state.outstandingBalance)} due`;
  if (state.kind === "part_paid") return `Part paid · ${formatGbp(state.outstandingBalance)} due`;
  return "Paid";
}

function invoiceStatusTone(state: AgentFeePortfolioInvoiceState) {
  if (state.kind === "paid") return "border-[#bedacb] bg-[#eaf6ee] text-[#286348]";
  if (state.kind === "rejected") return "border-[#e5c4be] bg-[#fbeeea] text-[#8d382d]";
  if (state.kind === "not_due" || (state.kind === "not_submitted" && !state.needsAction)) {
    return "border-[#d9ded6] bg-[#f2f4f0] text-[#617169]";
  }
  return "border-[#ead8a7] bg-[#fff4d9] text-[#765a18]";
}

function SummaryCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-bw-card border border-[#d9ded6] bg-white p-4">
      <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#617169]">{label}</p>
      <p className="numeric-value mt-2 text-2xl font-bold text-[#0F3D2E]">{value}</p>
      <p className="mt-1 text-xs text-[#617169]">{note}</p>
    </div>
  );
}

async function queryAgentFeePortfolio(requesterId: string) {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("get_agent_fee_portfolio", {
    p_requester_id: requesterId,
  });
  if (error) throw error;
  return ((data ?? []) as AgentFeePortfolioRpcRow[])
    .map((row) => deriveAgentFeePortfolioRow(mapPortfolioRow(row)))
    .sort((a, b) => a.buildingName.localeCompare(b.buildingName) || a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }));
}

export function AgentFeesPortfolio({
  requesterId,
  buildingContextId,
  buildingContextName,
  onOpenSale,
}: {
  requesterId: string;
  buildingContextId: string;
  buildingContextName: string;
  onOpenSale: (unitId: string, buildingId: string) => void;
}) {
  const [rows, setRows] = useState<AgentFeePortfolioRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<AgentFeePortfolioStatusFilter>("all");
  const [milestoneFilter, setMilestoneFilter] = useState<AgentFeePortfolioMilestoneFilter>("all");

  async function loadPortfolio() {
    setIsLoading(true);
    setError("");
    try {
      setRows(await queryAgentFeePortfolio(requesterId));
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "Agent Fees portfolio could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void queryAgentFeePortfolio(requesterId)
      .then((loadedRows) => {
        if (!cancelled) setRows(loadedRows);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setRows([]);
          setError(loadError instanceof Error ? loadError.message : "Agent Fees portfolio could not be loaded.");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [requesterId]);

  const contextRows = useMemo(
    () => buildingContextId ? rows.filter((row) => row.buildingId === buildingContextId) : rows,
    [buildingContextId, rows],
  );
  const agents = useMemo(() => Array.from(new Map(contextRows.map((row) => [row.agentOrganisationId ?? "unassigned", row.agentName])).entries())
    .sort((a, b) => a[1].localeCompare(b[1])), [contextRows]);
  const filteredRows = useMemo(() => filterAgentFeePortfolioRows(contextRows, {
    buildingId: "",
    agentOrganisationId: agentFilter,
    status: statusFilter,
    milestone: milestoneFilter,
  }), [agentFilter, contextRows, milestoneFilter, statusFilter]);
  const summary = useMemo(() => summariseAgentFeePortfolio(filteredRows), [filteredRows]);
  const scopeLabel = buildingContextId ? buildingContextName : "All buildings";

  return (
    <div className="grid gap-5">
      <section className="panel">
        <div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#617169]">Sales portfolio</p>
            <h2 className="mt-1 text-2xl font-bold text-[#0F3D2E]">Agent Fees</h2>
            <p className="mt-1 text-sm text-[#617169]">Current Exchange and Completion invoice positions across accessible unit sales.</p>
            <p className="mt-1 text-sm font-semibold text-[#34413a]">Scope: {scopeLabel}</p>
          </div>
        </div>

        {isLoading ? (
          <div className="mt-5 rounded-bw-card border border-[#d9ded6] bg-[#fbfcfa] p-6 text-sm text-[#617169]" role="status">Loading Agent Fees portfolio…</div>
        ) : error ? (
          <div className="mt-5 rounded-bw-card border border-[#e5c4be] bg-[#fff9f7] p-5" role="alert">
            <p className="font-bold text-[#7a271a]">Agent Fees portfolio could not be loaded.</p>
            <p className="mt-1 text-sm text-[#617169]">{error}</p>
            <button className="secondary mt-4" type="button" onClick={() => void loadPortfolio()}>Try again</button>
          </div>
        ) : contextRows.length === 0 ? (
          <div className="mt-5 rounded-bw-card border border-[#d9ded6] bg-[#fbfcfa] p-6 text-sm text-[#617169]">No active unit sales are available for {scopeLabel.toLowerCase()}.</div>
        ) : (
          <>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard label="Needs attention" value={summary.needsAttentionSales.toString()} note="Sales with a current invoice action" />
              <SummaryCard label="Awaiting approval" value={summary.awaitingApprovalInvoices.toString()} note="Active invoices awaiting review" />
              <SummaryCard label="Outstanding payments" value={formatGbp(summary.outstandingPayments)} note="Submitted or approved invoice balances" />
              <SummaryCard label="Future completion fees" value={formatGbp(summary.futureCompletionFeesNet)} note="Net fee not yet invoiced" />
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <label className="field-label">Agent<select className="field" value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)}><option value="">All agents</option>{agents.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
              <label className="field-label">Status<select className="field" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as AgentFeePortfolioStatusFilter)}>{statusFilters.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}</select></label>
              <label className="field-label">Milestone<select className="field" value={milestoneFilter} onChange={(event) => setMilestoneFilter(event.target.value as AgentFeePortfolioMilestoneFilter)}>{milestoneFilters.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}</select></label>
            </div>

            <div className="mt-5 overflow-x-auto rounded-bw-panel border border-[#d9ded6]">
              <table className="min-w-[52rem] w-full text-left text-sm">
                <thead className="bg-[#fbfcfa] text-xs uppercase text-[#617169]">
                  <tr>
                    <th className="border-b border-[#d9ded6] px-4 py-3">Unit</th>
                    <th className="border-b border-[#d9ded6] px-4 py-3">Building</th>
                    <th className="hidden border-b border-[#d9ded6] px-4 py-3 lg:table-cell">Agent</th>
                    <th className="numeric-value hidden border-b border-[#d9ded6] px-4 py-3 text-right lg:table-cell">Sale price</th>
                    <th className="border-b border-[#d9ded6] px-4 py-3">Exchange invoice</th>
                    <th className="border-b border-[#d9ded6] px-4 py-3">Completion invoice</th>
                    <th className="numeric-value border-b border-[#d9ded6] px-4 py-3 text-right">Current outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr><td className="px-4 py-8 text-center text-[#617169]" colSpan={7}>No sales match the selected filters.</td></tr>
                  ) : filteredRows.map((row) => (
                    <tr
                      key={row.saleAttemptId}
                      className="cursor-pointer bg-white transition-colors hover:bg-[#fbfcfa] focus-within:bg-[#fbfcfa]"
                      onClick={() => onOpenSale(row.unitId, row.buildingId)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onOpenSale(row.unitId, row.buildingId);
                        }
                      }}
                      tabIndex={0}
                      aria-label={`Open Agent Fees for unit ${row.unitNumber} at ${row.buildingName}`}
                    >
                      <td className="border-b border-[#eef0eb] px-4 py-3 font-bold text-[#0F3D2E]"><span className="inline-flex items-center gap-1">Unit {row.unitNumber}<ChevronRight size={15} aria-hidden /></span>{row.noLongerForSale && <span className="mt-1 block w-fit rounded-full border border-[#decda6] bg-[#fbf5e8] px-2 py-0.5 text-[11px] font-bold text-[#765a18]">No longer for sale</span>}</td>
                      <td className="border-b border-[#eef0eb] px-4 py-3 text-[#34413a]">{row.buildingName}</td>
                      <td className="hidden border-b border-[#eef0eb] px-4 py-3 text-[#34413a] lg:table-cell">{row.agentName}</td>
                      <td className="numeric-value hidden border-b border-[#eef0eb] px-4 py-3 text-right text-[#34413a] lg:table-cell">{formatGbp(row.salePrice)}</td>
                      <td className="border-b border-[#eef0eb] px-4 py-3"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${invoiceStatusTone(row.exchange)}`}>{invoiceStatusLabel(row.exchange)}</span></td>
                      <td className="border-b border-[#eef0eb] px-4 py-3"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${invoiceStatusTone(row.completion)}`}>{invoiceStatusLabel(row.completion)}</span></td>
                      <td className="numeric-value border-b border-[#eef0eb] px-4 py-3 text-right font-bold text-[#0F3D2E]">{formatGbp(row.currentOutstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-[#617169]">Current outstanding includes submitted or approved invoice balances. Future uninvoiced Completion fees are shown separately as net.</p>
          </>
        )}
      </section>
    </div>
  );
}
