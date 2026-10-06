"use client";

import { useState } from "react";
import type { Building, Organisation } from "@/lib/data/production";
import { salesContactOptions } from "@/lib/sales/legal-workflow";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function BuildingSalesContacts({ building, organisations, onNotice, reload }: {
  building: Building; organisations: Organisation[]; onNotice: (message: string) => void; reload: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conveyancer, setConveyancer] = useState(building.conveyancer_organisation_id ?? "");
  const [agent, setAgent] = useState(building.sales_agent_organisation_id ?? "");
  const [seller, setSeller] = useState(building.seller_name ?? "");
  const [completion, setCompletion] = useState(building.completion_information ?? "");
  async function save() {
    setBusy(true);
    const { error } = await createSupabaseBrowserClient().from("buildings").update({
      conveyancer_organisation_id: conveyancer || null, sales_agent_organisation_id: agent || null,
      seller_name: seller.trim() || null, completion_information: completion.trim() || null,
    }).eq("id", building.id);
    setBusy(false);
    if (error) { onNotice(error.message); return; }
    setEditing(false); onNotice("Sales contacts saved."); await reload();
  }
  const contactRows = ([
    ["conveyancer", "Conveyancer organisation", conveyancer, setConveyancer],
    ["sales_agent", "Sales agent organisation", agent, setAgent],
  ] as const);

  function cancelEditing() {
    setConveyancer(building.conveyancer_organisation_id ?? "");
    setAgent(building.sales_agent_organisation_id ?? "");
    setSeller(building.seller_name ?? "");
    setCompletion(building.completion_information ?? "");
    setEditing(false);
  }

  return <section id="sales-contacts" className="grid gap-4 border-t border-[#e5e9e4] pt-5">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h3 className="text-base font-semibold text-[#0F3D2E]">Sales contacts</h3>
        <p className="mt-1 text-sm text-[#617169]">Organisation shared inboxes receive sales instructions. Building access continues to follow existing user and organisation allocations.</p>
      </div>
      {!editing && <button className="snag-action-link" type="button" onClick={() => setEditing(true)}>Edit</button>}
    </div>
    {!editing ? <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
      {contactRows.map(([type, label, id]) => {
        const org = organisations.find((item) => item.id === id);
        return <div key={type}>
          <dt className="text-xs font-bold uppercase tracking-[0.06em] text-[#617169]">{label}</dt>
          <dd className="mt-1 font-semibold text-[#0F3D2E]">{org?.name ?? "Not selected"}</dd>
          {org && (org.shared_system_email
            ? <dd className="mt-0.5 break-all text-xs text-[#617169]">{org.shared_system_email}</dd>
            : <dd className="mt-0.5 text-xs text-amber-800">Shared system email missing. <a className="underline" href={`/?screen=users#organisation-${org.id}`}>Edit organisation</a></dd>)}
        </div>;
      })}
      <div>
        <dt className="text-xs font-bold uppercase tracking-[0.06em] text-[#617169]">Seller/SPV</dt>
        <dd className="mt-1 font-semibold text-[#0F3D2E]">{seller || "Not configured"}</dd>
        {!seller && <dd className="mt-0.5 text-xs text-amber-800">Required before instructions can be sent</dd>}
      </div>
      <div>
        <dt className="text-xs font-bold uppercase tracking-[0.06em] text-[#617169]">Agreed completion information</dt>
        <dd className="mt-1 font-semibold text-[#0F3D2E]">{completion || "Contractual completion date to be confirmed"}</dd>
      </div>
    </dl> : <div className="grid gap-4 rounded-bw-card border border-[#d9ded6] bg-[#fbfcfa] p-4">
      <div className="grid gap-3 lg:grid-cols-2">
        {contactRows.map(([type, label, id, setId]) => <label className="field-label" key={type}>{label}
          <select className="field min-h-10 py-2" aria-label={label} value={id} onChange={(event) => setId(event.target.value)} disabled={busy}>
            <option value="">Not selected</option>
            {salesContactOptions(organisations, type).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>)}
        <label className="field-label">Seller/SPV<input className="field min-h-10 py-2" value={seller} onChange={(event) => setSeller(event.target.value)} disabled={busy} /></label>
        <label className="field-label">Agreed completion information<textarea className="field min-h-24 py-2" value={completion} onChange={(event) => setCompletion(event.target.value)} disabled={busy} /></label>
      </div>
      <div className="flex justify-end gap-2 border-t border-[#e5e9e4] pt-4">
        <button className="secondary min-h-9 px-3 py-1.5 text-sm" type="button" disabled={busy} onClick={cancelEditing}>Cancel</button>
        <button className="primary min-h-9 px-3 py-1.5 text-sm" type="button" disabled={busy} onClick={() => void save()}>Save changes</button>
      </div>
    </div>}
  </section>;
}
