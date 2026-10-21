"use client";
import { addCalendarMonths, timingDescription, type FurtherDepositTiming } from "@/lib/sales/further-deposit";

export function FurtherDepositTimingFields({ value, months, onChange, onMonths, pcDate }: {
  value: FurtherDepositTiming | null; months: string; onChange: (value: FurtherDepositTiming) => void;
  onMonths: (value: string) => void; pcDate?: string | null;
}) {
  const basis = value?.basis ?? "after_exchange";
  const offset = basis === "after_exchange" ? months : value?.months?.toString() ?? "";
  const forecast = basis === "before_pc" && pcDate && offset !== "" ? addCalendarMonths(pcDate, -Number(offset)) : null;
  return <div className="grid min-w-0 gap-3 sm:col-span-2">
    <label className="field-label">Timing basis<select className="field" value={basis} onChange={event => onChange({ basis: event.target.value as FurtherDepositTiming["basis"] })}>
      <option value="after_exchange">Months after exchange</option><option value="before_pc">Months before practical completion</option><option value="fixed">Specific date and time</option>
    </select></label>
    {basis === "fixed" ? <div className="grid gap-3 sm:grid-cols-2">
      <label className="field-label">Deadline date<input type="date" className="field" required value={value?.date ?? ""} onChange={e => onChange({ ...value!, date: e.target.value, instant: null })} /></label>
      <label className="field-label">Deadline time — UK<input type="time" className="field" required value={value?.time ?? ""} onChange={e => onChange({ ...value!, time: e.target.value, instant: null })} /></label>
    </div> : <label className="field-label">Calendar months<input className="field" type="number" min="0" max="1200" step="1" required value={offset} onChange={e => {
      if (basis === "after_exchange") onMonths(e.target.value);
      onChange({ basis, months: e.target.value === "" ? null : Number(e.target.value) });
    }} /></label>}
    <p className="text-xs text-[#617169]">{timingDescription(value, months === "" ? null : Number(months))}{basis === "before_pc" ? forecast ? ` · Estimated date: ${forecast}. Confirm the contractual deadline after exchange.` : " · Exact target PC date needed for an estimate; a month alone is insufficient." : basis === "after_exchange" ? " · Calculated from the actual legal exchange date; month ends are clamped to the last day." : " · Retained fixed deadlines do not move when target PC changes."}</p>
  </div>;
}
