"use client";

import { useState } from "react";
import { emailDate, emailMoney } from "@/lib/sales/legal-email";
import { legalDateTime } from "@/lib/sales/legal-workflow";
import { isCalendarDate } from "@/lib/sales/completion-notice";

export type ExchangeDepositContext = {
  source: { id: string; expected_amount: number | null; source_kind: string; authority_version: number | null; terms_version: number | null } | null;
  receipt: { id: string; received_amount: number; received_date: string; recorded_by_name: string; recorded_at: string; revision: number; correction_reason: string | null } | null;
};
const todayInLondon = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export function ExchangeDepositReceipt({ deposit, exchanged, editable, busy, run }: {
  deposit?: ExchangeDepositContext; exchanged: boolean; editable: boolean; busy: boolean;
  run: (body: Record<string, unknown>, message: string) => Promise<boolean>;
}) {
  const [date, setDate] = useState(todayInLondon);
  const [confirmed, setConfirmed] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [reason, setReason] = useState("");
  const source = deposit?.source;
  const receipt = deposit?.receipt;
  const amount = source?.expected_amount;
  const validDate = isCalendarDate(date) && date <= todayInLondon();
  const canSubmit = !busy && validDate && (correcting ? Boolean(reason.trim()) && date !== receipt?.received_date : confirmed);

  return <li className="py-5" id="exchange-deposit-task">
    <h4 className="font-bold">4. Confirm deposit received</h4>
    {!exchanged ? <p className="mt-2 text-sm text-[#617169]">Locked until the conveyancer records legal exchange.</p> : <>
      <p className="mt-2 text-sm font-semibold text-[#0F3D2E]">{receipt ? "Deposit received" : "Deposit confirmation outstanding"}</p>
      {source && amount !== null && amount !== undefined ? <>
        <div className="mt-4 rounded-xl border border-[#d9ded6] bg-[#f5f7f3] p-4">
          <p className="text-lg font-bold text-[#0F3D2E]">Expected exchange deposit: {emailMoney(amount)}</p>
          <p className="mt-1 text-xs text-[#617169]">{source.source_kind === "executed_authority" ? `Exchange authority version ${source.authority_version}` : "Historical locked commercial terms"}{source.terms_version ? ` · Commercial version ${source.terms_version}` : ""}. Amount retained from the exchange record.</p>
        </div>
        {receipt && <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-[#617169]">Amount received</dt><dd className="font-semibold">{emailMoney(receipt.received_amount)}</dd></div>
          <div><dt className="text-[#617169]">Date received</dt><dd className="font-semibold">{emailDate(receipt.received_date)}</dd></div>
          <div><dt className="text-[#617169]">Recorded by</dt><dd>{receipt.recorded_by_name}</dd></div>
          <div><dt className="text-[#617169]">Date and time recorded</dt><dd>{legalDateTime(receipt.recorded_at)}</dd></div>
          {receipt.revision > 1 && <div className="sm:col-span-2"><dt className="text-[#617169]">Audited date correction</dt><dd>{receipt.correction_reason}. Original confirmation and corrections are retained in Activity.</dd></div>}
        </dl>}
        {editable && receipt && !correcting && <button className="secondary mt-4" disabled={busy} onClick={() => { setDate(receipt.received_date); setReason(""); setCorrecting(true); }}>Correct receipt date</button>}
        {editable && (!receipt || correcting) && <form className="mt-4 grid gap-4" onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          void run({ action: correcting ? "correct_exchange_deposit_date" : "confirm_exchange_deposit", sourceId: source.id, date,
            ...(correcting ? { previousReceiptId: receipt?.id, reason } : { confirmed }) }, correcting ? "Deposit receipt date corrected. The original record is retained in Activity." : "Exchange deposit receipt recorded.").then((saved) => { if (saved) { setCorrecting(false); setConfirmed(false); } });
        }}>
          <label className="field-label">Date deposit received<input className="field max-w-md" type="date" required max={todayInLondon()} value={date} disabled={busy} onChange={(event) => setDate(event.target.value)} /></label>
          {correcting ? <label className="field-label">Reason for correction<textarea className="field max-w-xl" required value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} /></label>
            : <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" required checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />I confirm that the full expected exchange deposit of {emailMoney(amount)} has been received.</label>}
          <div className="flex flex-wrap gap-2"><button className="primary" disabled={!canSubmit}>{correcting ? "Save corrected receipt date" : "Confirm deposit received"}</button>{correcting && <button type="button" className="secondary" disabled={busy} onClick={() => setCorrecting(false)}>Cancel correction</button>}</div>
        </form>}
        {!receipt && <p className="mt-3 text-sm text-[#617169]">{editable ? "If the full amount has not been received, leave this task outstanding and raise the discrepancy in Comments." : "The building’s conveyancer records receipt of the full deposit."} Completion remains available while this task is outstanding.</p>}
      </> : <p className="mt-3 text-sm text-amber-800">The locked exchange deposit amount is unavailable. Raise the missing commercial record in Comments before confirming receipt. Completion remains available.</p>}
    </>}
  </li>;
}
