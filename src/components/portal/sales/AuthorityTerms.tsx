import type { ReactNode } from "react";
import { DisplayValue, isEmptyDisplayValue } from "@/components/portal/DisplayValue";
import { timingDescription, type FurtherDepositTiming } from "@/lib/sales/further-deposit";
import { emailMoney } from "@/lib/sales/legal-email";
import type { LegalSnapshot } from "@/lib/sales/legal-workflow";

function TextValue({ value }: { value: unknown }) {
  return <DisplayValue value={value == null ? null : String(value)} />;
}

function MoneyValue({ value }: { value: unknown }) {
  return <DisplayValue value={isEmptyDisplayValue(value) ? null : emailMoney(value)} />;
}

function PercentValue({ value }: { value: unknown }) {
  return <DisplayValue value={isEmptyDisplayValue(value) ? null : `${value}%`} />;
}

/** Render individual missing terms without changing the saved legal snapshot or email. */
export function AuthorityTerms({ snapshot }: { snapshot: LegalSnapshot }) {
  const t = snapshot.terms;
  const furtherTiming = timingDescription(t.further_deposit_timing as FurtherDepositTiming | null, t.second_deposit_months_after_exchange == null ? null : Number(t.second_deposit_months_after_exchange));
  const exchangeAmount = isEmptyDisplayValue(t.contract_price) || isEmptyDisplayValue(t.exchange_deposit_percent)
    ? null : Number(t.contract_price) * Number(t.exchange_deposit_percent) / 100;
  const rows: [string, ReactNode][] = [
    ["Seller/SPV", <TextValue value={snapshot.building.seller_name} />],
    ["Development and plot", <><TextValue value={snapshot.building.name} /> – <TextValue value={snapshot.plot} /></>],
    ["Buyer name or names", <TextValue value={snapshot.buyer} />],
    ["Contract price", <MoneyValue value={t.contract_price} />],
    ["Reservation fee", <><MoneyValue value={t.reservation_fee} /> (held by <TextValue value={t.reservation_fee_holder == null ? null : String(t.reservation_fee_holder).replaceAll("_", " ")} />)</>],
    ["Exchange deposit", <><MoneyValue value={exchangeAmount} /> (<PercentValue value={t.exchange_deposit_percent} />)</>],
    ["Payment structure", isEmptyDisplayValue(t.deposit_summary) ? <>
      <PercentValue value={t.exchange_deposit_percent} /> on exchange
      {Boolean(t.second_deposit_enabled) && <>; <PercentValue value={t.second_deposit_percent} /> further deposit: {furtherTiming}</>}
      {"; "}{t.completion_balance_percent == null ? "remaining balance" : <PercentValue value={t.completion_balance_percent} />} on completion
    </> : <TextValue value={t.deposit_summary} />],
    ["Incentives or contributions", <>Developer: <MoneyValue value={t.developer_contribution} />; agent: <MoneyValue value={t.agent_contribution} />; other concessions: <MoneyValue value={t.other_concessions} /></>],
    ["Parking", <><TextValue value={t.parking_location_details} />; value <MoneyValue value={t.parking_value} />; contribution <MoneyValue value={t.parking_contribution_value} /></>],
    ["Completion information", <TextValue value={snapshot.building.completion_information} />],
    ["Special terms or agreed variations", <DisplayValue value={[t.commercial_summary, ...(Array.isArray(t.additional_special_conditions) ? t.additional_special_conditions : [])].filter(value => !isEmptyDisplayValue(value)).join("; ")} />],
    ...snapshot.schedule.map((row): [string, ReactNode] => [
      `Payment: ${row.payment_stage === "delayed_deposit" ? "Further deposit" : row.label}`,
      <><MoneyValue value={row.expected_amount ?? row.fixed_amount} />; <PercentValue value={row.percent_of_contract_price} />; due {row.payment_stage === "delayed_deposit" ? furtherTiming : `${row.due_event ?? row.due_date ?? "as agreed"}${row.due_offset_days ? ` + ${row.due_offset_days} days` : ""}`}{row.notes ? `; ${row.notes}` : ""}</>,
    ]),
  ];

  return <dl className="mt-4 divide-y divide-[#eef0eb]">{rows.map(([label, value], index) => <div className="grid gap-1 py-2 text-sm sm:grid-cols-[13rem_1fr]" key={`${label}-${index}`}>
    <dt className="text-[#617169]">{label}</dt><dd className="min-w-0 whitespace-pre-wrap font-medium [overflow-wrap:anywhere]">{value}</dd>
  </div>)}</dl>;
}
