"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { AlertCircle, Check, FileText, LockKeyhole, UploadCloud, X } from "lucide-react";
import type { SalesStageAction } from "@/lib/sales/permissions";
import { canPerformSalesAction } from "@/lib/sales/permissions";
import { formatGbp } from "@/lib/sales/currency";
import { buildings, type Role, type FixtureUnit } from "@/lib/experiments/sales-workspace/model";
import s from "./Workspace.module.css";

export { formatGbp as money };
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "warning" }) {
  return <span className={s.badge} data-tone={tone}><span aria-hidden="true" />{children}</span>;
}
export function Notice({ children, warning = false }: { children: ReactNode; warning?: boolean }) {
  return <div className={s.notice} data-warning={warning}><AlertCircle size={17} aria-hidden="true" /><div>{children}</div></div>;
}
export function Action({ children, role, action, primary = false }: { children: ReactNode; role: Role; action: SalesStageAction; primary?: boolean }) {
  if (!canPerformSalesAction(role, action)) return null;
  return <button type="button" disabled className={primary ? s.primary : s.button} title="Unavailable in this read-only prototype"><LockKeyhole size={14} aria-hidden="true" />{children}</button>;
}
export function ReadOnlyNote() { return <p className={s.readonly}><LockKeyhole size={13} aria-hidden="true" />Business actions are unavailable in this prototype.</p>; }
export function KeyValues({ items }: { items: [string, ReactNode][] }) {
  return <dl className={s.keyValues}>{items.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>;
}
export function Field({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return <label className={wide ? s.wideField : s.field}>{label}<input readOnly value={value} /></label>;
}
export function UploadPreview({ label }: { label: string }) {
  return <div className={s.upload} aria-label={label}><UploadCloud size={23} aria-hidden="true" /><strong>{label}</strong><span>PDF only · up to 10 MB</span><button className={s.button} disabled><LockKeyhole size={14} aria-hidden="true" />Choose a PDF</button><small>File selection and upload are unavailable in this prototype.</small></div>;
}
export function Heading({ eyebrow, title, description, badge }: { eyebrow: string; title: string; description: string; badge?: ReactNode }) {
  return <header className={s.pageHeading}><div><p className={s.eyebrow}>{eyebrow}</p><h1 tabIndex={-1} id="workspace-heading">{title}</h1><p>{description}</p></div>{badge}</header>;
}
export function History({ completed = false }: { completed?: boolean }) {
  return <ol className={s.timeline}>
    {completed && <li><Check size={16} /><div><strong>Legal completion confirmed</strong><p>3 Nov 2026, 10:30 · Jamie Ellis, conveyancer</p><small>Keys available for handover.</small></div></li>}
    <li><Check size={16} /><div><strong>{completed ? "Both current documents approved" : "Completion documents received"}</strong><p>{completed ? "2 Nov 2026, 14:20 · Dana Miller, developer" : "30 Oct 2026, 09:15 · Jamie Ellis, conveyancer"}</p></div></li>
    <li><Check size={16} /><div><strong>Notice served · completion due 3 November</strong><p>20 Oct 2026 · Jamie Ellis, conveyancer</p></div></li>
    <li><Check size={16} /><div><strong>Authority to serve notice given</strong><p>19 Oct 2026 · Dana Miller, developer</p><small>Request received from Jamie Ellis on 19 October.</small></div></li>
    <li><Check size={16} /><div><strong>Exchange confirmed</strong><p>16 Oct 2026 · Jamie Ellis, conveyancer</p></div></li>
    <li><Check size={16} /><div><strong>Reservation approved</strong><p>7 Oct 2026 · Dana Miller, developer</p></div></li>
  </ol>;
}
export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = dialog.current!;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    node.showModal();
    closeButton.current?.focus();
    return () => { node.close(); document.body.style.overflow = overflow; previous?.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} className={wide ? s.documentModal : s.drawer} aria-label={title}
    onKeyDown={event => {
      if (event.key !== "Tab") return;
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])')).filter(item => item.getClientRects().length > 0);
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={s.modalInner}><header className={s.modalHeader}><div><p className={s.eyebrow}>Bunnywell · fictional fixtures</p><h2>{title}</h2></div><button ref={closeButton} className={s.iconButton} onClick={onClose} aria-label="Close dialog"><X size={20} /></button></header>{children}</div>
  </dialog>;
}
export type Preview = { title: string; file: string; version?: string; date?: string; previous?: boolean; query?: string; amount?: number };
export function DocumentPreview({ preview, unit }: { preview: Preview; unit: FixtureUnit }) {
  return <><Notice>Fictional sample document. This local HTML preview makes no document-service request.</Notice><article className={s.paper} aria-label="Sample document content">
    <div className={s.paperBrand}><FileText size={28} /><span>GARDEN LANE LEGAL<br /><small>Sample conveyancing practice</small></span><Badge>{preview.previous ? "Previous version" : "Current version"}</Badge></div>
    <h3>{preview.title}</h3><p>{preview.file} {preview.version && "· " + preview.version}</p>
    {preview.previous && <Notice warning>This version has been superseded. It cannot be used for current approval.</Notice>}
    {preview.query && <Notice warning><strong>Query on this version</strong><br />{preview.query}</Notice>}
    <KeyValues items={[["Property", unit.unit_number + " · " + buildings.find(b => b.id === unit.building_id)!.name], ["Purchaser", unit.buyer], ["Contract price", formatGbp(425000)], ["Contractual completion", "3 November 2026"], ["Document date", preview.date ?? "30 October 2026"]]} />
    <h4>Transaction record</h4><p>This illustrative document records the agreed transaction details for the selected fictional unit. It is provided solely to assess the document-review experience.</p>
    <KeyValues items={preview.title.toLowerCase().includes("invoice") ? [["Submitted invoice total", formatGbp(preview.amount ?? 7650)], ["Exchange fee, net", formatGbp(6375)], ["VAT at 20%", formatGbp(1275)], ["Expected gross fee", formatGbp(7650)], ["Credits applied separately", formatGbp(2500)]] : [["Contract price", formatGbp(425000)], ["Exchange deposit (10%)", formatGbp(42500)], ["Balance of purchase price", formatGbp(382500)]]} />
    <footer>SAMPLE · No legal or financial effect · Page 1 of 1</footer>
  </article></>;
}
