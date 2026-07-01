"use client";

import { Building2, CheckCircle2, Home, Plus, Send, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ResidentType } from "@/lib/data/production";

type BuildingOption = {
  id: string;
  name: string;
};

type UnitOption = {
  id: string;
  buildingId: string;
  unitNumber: string;
  floor: string | null;
};

type RequestedUnitDraft = {
  buildingId: string;
  unitId: string;
};

const residentTypeOptions: Array<{ value: ResidentType; label: string }> = [
  { value: "leaseholder", label: "Leaseholder" },
  { value: "tenant", label: "Tenant" },
  { value: "letting_agent", label: "Letting Agent" },
  { value: "managing_agent", label: "Managing Agent" },
];

const emptyRequestedUnit: RequestedUnitDraft = { buildingId: "", unitId: "" };

export function RequestAccessPage() {
  const [buildings, setBuildings] = useState<BuildingOption[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [residentType, setResidentType] = useState<ResidentType>("leaseholder");
  const [requestedUnits, setRequestedUnits] = useState<RequestedUnitDraft[]>([emptyRequestedUnit]);
  const [notes, setNotes] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [notice, setNotice] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const canSubmit = Boolean(
    fullName.trim()
    && email.trim()
    && phone.trim()
    && consent
    && requestedUnits.some((item) => item.buildingId && item.unitId)
    && !isSubmitting,
  );

  useEffect(() => {
    fetch("/api/access-requests")
      .then(async (response) => {
        const payload = (await response.json()) as { buildings?: BuildingOption[]; units?: UnitOption[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Could not load buildings.");
        setBuildings(payload.buildings ?? []);
        setUnits(payload.units ?? []);
      })
      .catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : "Could not load buildings.");
      })
      .finally(() => setIsLoading(false));
  }, []);

  const unitOptionsByBuilding = useMemo(() => {
    return units.reduce<Record<string, UnitOption[]>>((groups, unit) => {
      groups[unit.buildingId] = [...(groups[unit.buildingId] ?? []), unit];
      return groups;
    }, {});
  }, [units]);

  function updateRequestedUnit(index: number, updates: Partial<RequestedUnitDraft>) {
    setRequestedUnits((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...updates } : item
    )));
  }

  function addRequestedUnit() {
    setRequestedUnits((current) => [...current, { ...emptyRequestedUnit }]);
  }

  function removeRequestedUnit(index: number) {
    setRequestedUnits((current) => current.length === 1 ? current : current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function submitRequest() {
    if (!canSubmit) {
      setNotice("Complete the required fields before submitting.");
      return;
    }

    setIsSubmitting(true);
    setNotice("");

    try {
      const response = await fetch("/api/access-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          email,
          phone,
          residentType,
          requestedUnits,
          notes,
          consent,
          website,
        }),
      });
      const payload = (await response.json()) as { error?: string; id?: string };

      if (!response.ok) {
        setNotice(payload.error ?? "Could not submit request.");
        return;
      }

      setSubmitted(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not submit request.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <RequestAccessShell notice={notice}>
        <section className="panel mx-auto max-w-xl text-center">
          <CheckCircle2 className="mx-auto text-[#147A4D]" size={42} aria-hidden />
          <h2 className="mt-4 text-2xl font-bold text-[#0F3D2E]">Request submitted</h2>
          <p className="mt-3 text-base font-semibold text-[#1F2A24]">Thanks, your access request has been received.</p>
          <p className="mt-3 text-sm text-[#617169]">
            We&apos;ll review it and let you know when your Bunnywell portal access is ready.
          </p>
        </section>
      </RequestAccessShell>
    );
  }

  return (
    <RequestAccessShell notice={notice}>
      <section className="grid gap-5 lg:grid-cols-[minmax(0,0.82fr)_minmax(30rem,1fr)] lg:items-start">
        <div className="py-2">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#D6A23A]">Bunnywell Portal</p>
          <h2 className="mt-2 max-w-xl text-3xl font-bold leading-tight text-[#0F3D2E] sm:text-5xl">Request access</h2>
          <p className="mt-4 max-w-lg text-base text-[#617169]">
            Submit the flat details linked to your Bunnywell portal account. We&apos;ll review your request before access is granted.
          </p>
        </div>

        <section className="panel">
          <div className="grid gap-4">
            <input className="hidden" tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} aria-hidden />

            <div className="form-section">
              <h3 className="text-sm font-bold text-[#0F3D2E]">Your details</h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="field-label">
                  Name
                  <input className="field" value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" />
                </label>
                <label className="field-label">
                  Email
                  <input className="field" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" type="email" />
                </label>
                <label className="field-label">
                  Phone
                  <input className="field" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" type="tel" />
                </label>
                <label className="field-label">
                  Resident type
                  <select className="field" value={residentType} onChange={(event) => setResidentType(event.target.value as ResidentType)}>
                    {residentTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              </div>
            </div>

            <div className="form-section">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-[#0F3D2E]">Flat access</h3>
                  <p className="mt-1 text-sm text-[#617169]">Add the flat you need access to. Most residents only need to add one flat.</p>
                </div>
                <button className="secondary min-h-9 px-3 py-1.5 text-sm" type="button" onClick={addRequestedUnit}>
                  <Plus size={16} aria-hidden />
                  Add flat
                </button>
              </div>

              <div className="mt-3 grid gap-3">
                {requestedUnits.map((requestedUnit, index) => {
                  const buildingUnits = unitOptionsByBuilding[requestedUnit.buildingId] ?? [];

                  return (
                    <div key={index} className="card-surface p-3">
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                        <label className="field-label">
                          Building
                          <select
                            className="field"
                            value={requestedUnit.buildingId}
                            onChange={(event) => updateRequestedUnit(index, { buildingId: event.target.value, unitId: "" })}
                            disabled={isLoading}
                          >
                            <option value="">{isLoading ? "Loading buildings" : "Choose building"}</option>
                            {buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}
                          </select>
                        </label>
                        <label className="field-label">
                          Flat
                          <select
                            className="field"
                            value={requestedUnit.unitId}
                            onChange={(event) => updateRequestedUnit(index, { unitId: event.target.value })}
                            disabled={!requestedUnit.buildingId || isLoading}
                          >
                            <option value="">Choose flat</option>
                            {buildingUnits.map((unit) => (
                              <option key={unit.id} value={unit.id}>
                                {unit.unitNumber}{unit.floor ? ` / ${unit.floor}` : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          className="danger-icon-button self-end"
                          type="button"
                          onClick={() => removeRequestedUnit(index)}
                          disabled={requestedUnits.length === 1}
                          aria-label="Remove flat"
                          title="Remove flat"
                        >
                          <Trash2 size={16} aria-hidden />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="form-section">
              <label className="field-label">
                Notes
                <textarea className="field min-h-28 py-3" value={notes} onChange={(event) => setNotes(event.target.value)} />
              </label>
              <label className="option-card mt-3">
                <input checked={consent} onChange={(event) => setConsent(event.target.checked)} type="checkbox" />
                I confirm these details can be used to review my Bunnywell portal access request.
              </label>
              <p className="mt-3 text-sm text-[#617169]">The Bunnywell portal is used for handover records, useful documents and initial snag reporting where available.</p>
            </div>

            <button className="primary w-full" onClick={submitRequest} disabled={!canSubmit}>
              <Send size={16} aria-hidden />
              {isSubmitting ? "Submitting request" : "Submit request"}
            </button>
          </div>
        </section>
      </section>
    </RequestAccessShell>
  );
}

function RequestAccessShell({ children, notice }: { children: ReactNode; notice: string }) {
  return (
    <main className="app-shell min-h-screen pb-12">
      <header className="app-header">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/bunnywell-logo-icon.jpg" alt="Bunnywell Homes" className="h-11 w-auto shrink-0 object-contain sm:h-12" />
            <div>
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.24em] text-[#D6A23A] sm:text-xs">Bunnywell</p>
              <h1 className="truncate text-lg font-bold text-[#0F3D2E] sm:text-2xl">Portal</h1>
            </div>
          </div>
          <span className="account-pill">
            <Building2 size={16} aria-hidden />
            <span>Access request</span>
          </span>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {notice && (
          <div className="notification mb-4" role="status">
            <Home size={16} aria-hidden />
            {notice}
          </div>
        )}
        {children}
      </div>
    </main>
  );
}
