"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { furtherDepositState, londonDateTime, type FurtherDepositFact } from "@/lib/sales/further-deposit";
import { emailDate, emailMoney } from "@/lib/sales/legal-email";
import { legalDateTime } from "@/lib/sales/legal-workflow";
import { runAndRefresh, settleRefreshes } from "@/lib/sales/action-refresh";
import { ExchangeDepositReceipt, type ExchangeDepositContext } from "./ExchangeDepositReceipt";

type Receipt = { id: string; amount: number; received_date: string; received_time: string | null; note: string | null; voided: boolean; supersedes_id: string | null; revision: number; reason: string | null; recorded_by_name: string; recorded_at: string };
export type DepositsContext = { exchange: ExchangeDepositContext; further: FurtherDepositFact; exchanged: boolean; completed: boolean; active: boolean; canRecord: boolean; canAmendDeadline: boolean; receipts: Receipt[]; deadlines: { id: string; date: string; time: string | null; reason: string; recorded_by_name: string; recorded_at: string }[] };
export function SaleDeposits({ saleId, refreshKey, onChanged, onNotice }: { saleId: string; refreshKey?: string | null; onChanged: (sale: string, action: string) => Promise<void>; onNotice: (message: string) => void }) {
  const [context, setContext] = useState<DepositsContext | null>(null);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now);
  const alive = useRef(true), inFlight = useRef(false), sequence = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    const result = await createSupabaseBrowserClient().rpc("sales_deposit_context", { p_sale: saleId });
    if (result.error) throw new Error(result.error.message);
    if (alive.current && sequence.current === current) setContext(result.data as DepositsContext);
  }, [saleId]);
  useEffect(() => { void load().catch(e => setFailure(e.message)); }, [load, refreshKey]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  async function run(body: Record<string, unknown>, message: string) {
    if (inFlight.current) return false;
    inFlight.current = true; setBusy(true); setFailure("");
    try {
      await runAndRefresh(async () => {
        const client = createSupabaseBrowserClient();
        if (String(body.action).includes("exchange_deposit")) {
          const session = await client.auth.getSession();
          if (!session.data.session) throw new Error("Sign in again to continue.");
          const response = await fetch("/api/sales/legal", { method: "POST", headers: { Authorization: `Bearer ${session.data.session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...body, sale: saleId }) });
          const result = await response.json(); if (!response.ok) throw new Error(result.error || "Receipt could not be saved.");
        } else {
          const { action, ...payload } = body;
          const result = await client.rpc("sales_further_deposit_action", { p_sale: saleId, p_action: action, p_payload: payload });
          if (result.error) throw new Error(result.error.message);
        }
      }, () => settleRefreshes([load(), onChanged(saleId, String(body.action))]));
      onNotice(message); return true;
    } catch (e) { if (alive.current) setFailure(e instanceof Error ? e.message : "Receipt could not be saved."); return false; }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  return <section id="sale-deposits" role="tabpanel" aria-labelledby="financials-deposits" className="min-w-0 rounded-b-bw-panel border border-t-0 border-[#d9ded6] bg-white p-4 sm:p-6">
    <h3 className="text-xl font-bold text-[#0F3D2E]">Deposits</h3>
    <p className="mt-1 text-sm text-[#617169]">Buyer deposits are tracked against the retained sale terms. Receipt records do not change legal progression or agent fees.</p>
    {failure && <p role="alert" className="my-3 text-sm text-red-800">{failure} <button className="underline" onClick={() => void load().catch(e => setFailure(e.message))}>Refresh deposits</button></p>}
    {!context ? <p className="py-6" role="status">Loading deposits…</p> : <>
      <ExchangeDepositReceipt deposit={context.exchange} exchanged={context.exchanged} editable={context.canRecord && context.active} busy={busy} run={run} />
      <FurtherDepositCard context={context} now={now} busy={busy} run={run} />
    </>}
  </section>;
}

export function FurtherDepositCard({ context, now, busy, run }: { context: DepositsContext; now: number; busy: boolean; run: (body: Record<string, unknown>, message: string) => Promise<boolean> }) {
  const [mode, setMode] = useState<"receipt" | "correction" | "void" | "deadline" | null>(null);
  const [amount, setAmount] = useState(""), [date, setDate] = useState(""), [time, setTime] = useState("");
  const [note, setNote] = useState(""), [reason, setReason] = useState(""), [excess, setExcess] = useState(false);
  const [previous, setPrevious] = useState<Receipt | null>(null);
  const request = useRef("");
  const expectedReceived = useRef(0);
  const previousDeadline = useRef<string | null>(null);
  const fact = context.further, state = furtherDepositState(fact, now);
  const superseded = new Set(context.receipts.map(receipt => receipt.supersedes_id));
  function renewRequest() { request.current = crypto.randomUUID(); expectedReceived.current = fact.received_amount; previousDeadline.current = fact.deadline?.id ?? null; }
  function open(next: NonNullable<typeof mode>, receipt?: Receipt) {
    setMode(next); setPrevious(receipt ?? null); setAmount(receipt ? String(receipt.amount) : String(state.outstanding ?? ""));
    setDate(receipt?.received_date ?? (next === "deadline" ? state.date ?? "" : londonDateTime(now).date));
    setTime(receipt?.received_time?.slice(0, 5) ?? (next === "deadline" ? state.time ?? "" : ""));
    setReason(""); setNote(receipt?.note ?? ""); setExcess(false); renewRequest();
  }
  return <section id="further-deposit" className="min-w-0 border-t border-[#d9ded6] py-5">
    <h4 className="text-lg font-bold">Further deposit</h4>
    {!fact.required ? <p className="mt-2 text-sm text-[#617169]">No further deposit required.</p> : <>
      <div className="mt-3 flex flex-wrap gap-2 text-sm font-semibold"><span className="rounded-full bg-[#eef3ed] px-3 py-1">{state.payment}</span>{state.outstanding !== 0 && <span className={`rounded-full px-3 py-1 ${state.timing === "Overdue" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}`}>{context.exchanged ? state.timing : "Preview — before exchange"}</span>}</div>
      <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div><dt className="text-[#617169]">Expected{fact.percent != null ? ` (${fact.percent}%)` : ""}</dt><dd className="font-bold">{emailMoney(fact.expected_amount)}</dd></div>
        <div><dt className="text-[#617169]">Amount received</dt><dd className="font-bold">{emailMoney(fact.received_amount)}</dd></div>
        <div><dt className="text-[#617169]">Outstanding balance</dt><dd className="font-bold">{emailMoney(state.outstanding)}</dd></div>
        <div><dt className="text-[#617169]">{state.forecast ? "Estimated date" : "Deadline"}</dt><dd className="font-semibold">{state.date ? `${emailDate(state.date)}${state.time ? ` at ${state.time} UK time` : " (date only)"}` : "Needs confirmation"}</dd></div>
      </dl>
      <p className="mt-3 text-xs text-[#617169]">{state.explanation} · Commercial version {fact.terms_version ?? "unavailable"}. {context.exchanged ? "Agreed sale price and percentage retained at exchange." : "Preview only; no live collection task before legal exchange."}</p>
      {state.beforeExchange && <p className="mt-3 text-sm text-amber-900">Needs confirmation: this deadline falls before the recorded exchange date. Review the contract; the date has not been moved.</p>}
      {state.forecast && <p className="mt-2 text-sm text-amber-900">PC-derived forecast only. The developer must confirm the contractual deadline; changes to PC can move this estimate.</p>}
      {state.excess > 0 && <p role="status" className="mt-3 text-sm text-amber-900">Overpayment review exception: {emailMoney(state.excess)} excess recorded.</p>}
      {context.exchanged && state.outstanding != null && state.outstanding > 0 && <p className="mt-3 text-sm">{context.completed || !context.active ? "Reconcile retained deposit records" : state.confirmed ? "Receipt not fully recorded — confirm or chase" : "Deadline needs confirmation; receipt not fully recorded"}: {emailMoney(state.outstanding)}. A missing record does not establish non-payment.</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {context.exchanged && context.active && context.canRecord && <button type="button" className="primary" disabled={busy || !!mode || fact.expected_amount == null} onClick={() => open("receipt")}>Record receipt</button>}
        {context.exchanged && context.active && context.canAmendDeadline && <button type="button" className="secondary" disabled={busy || !!mode} onClick={() => open("deadline")}>{state.confirmed ? "Amend contractual deadline" : "Confirm contractual deadline"}</button>}
      </div>
      {mode && <form className="mt-4 grid min-w-0 gap-3 rounded-xl border border-[#d9ded6] bg-[#f5f7f3] p-4" onSubmit={async event => {
        event.preventDefault();
        const action = mode === "deadline" ? "confirm_further_deadline" : mode === "void" ? "void_further_receipt" : mode === "correction" ? "correct_further_receipt" : "record_further_receipt";
        const saved = await run({ action, sourceId: fact.id, requestId: request.current, expectedReceivedAmount: expectedReceived.current, amount, date, time: time || null, note, reason, acknowledgeExcess: excess,
          ...(previous ? { previousReceiptId: previous.id } : {}), ...(mode === "deadline" ? { previousDeadlineId: previousDeadline.current } : {}) }, mode === "deadline" ? "Contractual deadline saved with its amendment history." : "Further-deposit receipt history and balance updated.");
        if (saved) setMode(null);
      }}>
        <h5 className="font-bold">{mode === "deadline" ? "Confirm or amend agreed deadline" : mode === "void" ? "Void receipt" : mode === "correction" ? "Correct receipt" : "Record receipt"}</h5>
        {mode !== "void" && <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          {mode !== "deadline" && <label className="field-label">Amount received (£)<input className="field" required inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value); renewRequest(); }} disabled={busy} /></label>}
          <label className="field-label">{mode === "deadline" ? "Agreed deadline date" : "Actual date received"}<input className="field" type="date" required value={date} max={mode === "deadline" ? undefined : londonDateTime(now).date} onChange={e => { setDate(e.target.value); renewRequest(); }} disabled={busy} /></label>
          <label className="field-label">{mode === "deadline" ? "Deadline time, if specified" : "Actual receipt time, if known"} — UK<input className="field" type="time" value={time} onChange={e => { setTime(e.target.value); renewRequest(); }} disabled={busy} /></label>
          {mode !== "deadline" && <label className="field-label">Reference / note (optional)<input className="field" value={note} onChange={e => { setNote(e.target.value); renewRequest(); }} disabled={busy} /></label>}
        </div>}
        {mode !== "receipt" && <label className="field-label">{mode === "deadline" ? "Reason and contractual basis" : "Reason for correction"}<textarea className="field" required value={reason} onChange={e => { setReason(e.target.value); renewRequest(); }} disabled={busy} /></label>}
        {mode !== "deadline" && mode !== "void" && Number(amount) > (state.outstanding ?? 0) + Number(previous?.amount ?? 0) && <label className="flex items-start gap-2 text-sm"><input type="checkbox" required checked={excess} onChange={e => { setExcess(e.target.checked); renewRequest(); }} disabled={busy} />I confirm this creates an excess receipt for review.</label>}
        <p className="text-xs text-[#617169]">{mode === "deadline" ? "This audited commercial amendment retains the original agreed timing rule and all previous deadlines." : "Leave time blank if unknown. Date-only receipts on the deadline day cannot establish whether payment was before or after a timed cutoff. The entry timestamp is recorded separately."}</p>
        <div className="flex flex-wrap gap-2"><button className="primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button><button type="button" className="secondary" disabled={busy} onClick={() => setMode(null)}>Cancel</button></div>
      </form>}
      {context.receipts.length > 0 && <details className="mt-5" open><summary className="cursor-pointer font-semibold">Receipt history ({context.receipts.length})</summary><ul className="mt-2 divide-y divide-[#d9ded6]">{context.receipts.map(receipt => <li key={receipt.id} className="min-w-0 py-3 text-sm">
        <p className="font-semibold">{emailMoney(receipt.amount)} · {emailDate(receipt.received_date)}{receipt.received_time ? ` at ${receipt.received_time.slice(0,5)} UK time` : " · Time unknown"} · {receipt.voided ? "Voided" : superseded.has(receipt.id) ? "Superseded" : "Recorded"}</p>
        <p className="mt-1 text-xs text-[#617169]">Entered by {receipt.recorded_by_name} on {legalDateTime(receipt.recorded_at)} · Revision {receipt.revision}</p>
        {(receipt.note || receipt.reason) && <p className="mt-1 break-words">{receipt.note}{receipt.reason ? ` · Reason: ${receipt.reason}` : ""}</p>}
        {context.canRecord && context.active && !receipt.voided && !superseded.has(receipt.id) && <div className="mt-2 flex gap-4"><button className="underline" disabled={busy || !!mode} onClick={() => open("correction", receipt)}>Correct</button><button className="underline" disabled={busy || !!mode} onClick={() => open("void", receipt)}>Void</button></div>}
      </li>)}</ul></details>}
      {context.deadlines.length > 0 && <details className="mt-4 text-sm"><summary className="cursor-pointer font-semibold">Deadline amendment history</summary>{context.deadlines.map(d => <p key={d.id} className="mt-2 break-words">{emailDate(d.date)} {d.time?.slice(0,5)} · {d.reason} · {d.recorded_by_name}, {legalDateTime(d.recorded_at)}</p>)}</details>}
    </>}
  </section>;
}
