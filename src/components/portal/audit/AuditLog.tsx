"use client";

import {
  ArrowRight,
  Building2,
  FileText,
  Home,
  KeyRound,
  Search,
  Settings2,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  auditChangeSummary,
  formatAuditCategory,
  formatAuditEventType,
  formatAuditValue,
  getAuditCategory,
  getAuditChanges,
  getAuditSubject,
  profileName,
  sanitizeAuditMetadata,
} from "@/lib/audit/format";
import type {
  AuditCategory,
  AuditContext,
  AuditEvent,
} from "@/lib/audit/types";

type AuditLogProps = AuditContext & {
  events: AuditEvent[];
  totalEvents: number;
  buildingContextId: string;
};

type DateRange = "" | "today" | "7" | "30" | "90";

const categories: Array<AuditCategory | "all"> = ["all", "sales", "rentals", "users", "setup", "security", "reports"];

function eventIcon(category: AuditCategory) {
  const icons = {
    sales: Building2,
    rentals: Home,
    users: UserRound,
    setup: Settings2,
    security: ShieldCheck,
    reports: FileText,
    system: KeyRound,
  };
  return icons[category];
}

function eventDate(value: string, full = false) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("en-GB", full
    ? { dateStyle: "full", timeStyle: "medium" }
    : { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function eventTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function actorDetails(event: AuditEvent, context: AuditContext) {
  const actor = context.profiles.find((item) => item.id === event.created_by_user_id);
  const organisationId = event.actor_organisation_id ?? actor?.organisation_id;
  const organisation = context.organisations.find((item) => item.id === organisationId);
  return { name: event.actor_name || (event.created_by_user_id ? profileName(actor) : "System"), organisation: organisation?.name ?? null };
}

function inDateRange(createdAt: string, range: DateRange) {
  if (!range) return true;
  const date = new Date(createdAt);
  const now = new Date();
  if (range === "today") return date.toDateString() === now.toDateString();
  return date.valueOf() >= now.valueOf() - Number(range) * 86_400_000;
}

export function AuditLog({ buildingContextId, profiles, buildings, units, organisations }: AuditLogProps) {
  const context = useMemo(() => ({ profiles, buildings, units, organisations }), [buildings, organisations, profiles, units]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<AuditCategory | "all">("all");
  const [eventType, setEventType] = useState("");
  const [userId, setUserId] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>("");
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [stream, setStream] = useState("business");
  const [buildingId, setBuildingId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [saleId, setSaleId] = useState("");
  const [snagId, setSnagId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [trackingEnabled, setTrackingEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    if (stream !== "views") return;
    let valid = true;
    void createSupabaseBrowserClient().rpc("audit_unit_open_setting").then(({ data }) => { if(valid) setTrackingEnabled(typeof data === "boolean" ? data : null); });
    return () => { valid = false; };
  }, [stream]);
  type Cursor = { time: string; id: string; source: string } | null;
  const [hasNext, setHasNext] = useState(false);
  const [filterClock] = useState(() => Date.now());
  const relativeFrom = dateRange === "today" ? new Date(new Date(filterClock).setHours(0,0,0,0)).toISOString()
    : dateRange ? new Date(filterClock - Number(dateRange) * 86400000).toISOString() : "";
  const filtersKey = JSON.stringify({ stream, building: stream === "authentication" ? "" : buildingContextId || buildingId, unit: stream === "authentication" ? "" : unitId, sale: saleId, snag: snagId,
    actor: userId === "system" ? "" : userId, event: eventType, category: category === "all" ? "" : category,
    from: fromDate || relativeFrom,
    to: toDate ? new Date(new Date(toDate).valueOf() + 86400000).toISOString() : "" });
  const [pagination, setPagination] = useState<{ key: string; cursors: Cursor[] }>({ key: filtersKey, cursors: [null] });
  const cursors = pagination.key === filtersKey ? pagination.cursors : [null];
  const cursor = cursors[cursors.length - 1];
  const setCursors = (update: (c: Cursor[]) => Cursor[]) => setPagination(p => ({ key: filtersKey, cursors: update(p.key === filtersKey ? p.cursors : [null]) }));
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true); setError("");
      const { data, error } = await createSupabaseBrowserClient().rpc("portal_audit_page", {
        p_filters: JSON.parse(filtersKey), p_before_time: cursor?.time ?? null,
        p_before_id: cursor?.id ?? null, p_before_source: cursor?.source ?? null,
      });
      if (cancelled) return;
      setPagination(p => p.key === filtersKey ? p : { key: filtersKey, cursors: [null] });
      setLoading(false);
      if (error) { setEvents([]); setHasNext(false); setError(error.message); return; }
      const rows = (data ?? []) as AuditEvent[];
      setEvents(rows.slice(0,50)); setHasNext(rows.length > 50);
    }, 200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [filtersKey, cursor]);

  const eventTypes = useMemo(() => Array.from(new Set(events.map((event) => event.event_type))).sort((a, b) => formatAuditEventType(a).localeCompare(formatAuditEventType(b))), [events]);
  const actors = useMemo(() => [...profiles].sort((a, b) => profileName(a).localeCompare(profileName(b))), [profiles]);
  const rows = useMemo(() => events.map((event) => {
    const subject = getAuditSubject(event, context);
    const actor = actorDetails(event, context);
    const changes = getAuditChanges(event);
    return { event, subject, actor, changes, category: getAuditCategory(event), change: auditChangeSummary(event, changes) };
  }), [context, events]);
  const contextRows = useMemo(
    () => buildingContextId && stream !== "authentication" ? rows.filter((row) => row.subject.buildingId === buildingContextId) : rows,
    [buildingContextId, rows, stream],
  );
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return contextRows.filter((row) => {
      if (userId === "system" && row.event.created_by_user_id) return false;
      if (!query) return true;
      return [row.subject.primary, row.subject.secondary, row.actor.name, row.change, row.event.summary, formatAuditEventType(row.event.event_type)]
        .filter(Boolean).join(" ").toLowerCase().includes(query);
    });
  }, [contextRows, search, userId]);

  const lastThirtyDays = contextRows.filter((row) => inDateRange(row.event.created_at, "30")).length;
  const activeUsers = new Set(contextRows.filter((row) => inDateRange(row.event.created_at, "30") && row.event.created_by_user_id).map((row) => row.event.created_by_user_id)).size;
  const latest = contextRows[0]?.event.created_at;
  const hasFilters = Boolean(search || eventType || userId || dateRange || category !== "all" || buildingId || unitId || saleId || snagId || fromDate || toDate);

  useEffect(() => {
    if (!selectedEvent) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedEvent(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [selectedEvent]);

  function resetFilters() {
    setSearch("");
    setCategory("all");
    setEventType("");
    setUserId("");
    setDateRange("");
    setBuildingId(""); setUnitId(""); setSaleId(""); setSnagId(""); setFromDate(""); setToDate("");
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-[#d9ded6] bg-white">
      <div className="border-b border-[#d9ded6] px-4 py-4 sm:px-5">
        <h2 className="text-lg font-semibold text-[#1F2A24]">Audit log</h2>
        <p className="mt-0.5 text-sm text-[#617169]">A searchable history of important changes across the portal.</p>
        <label className="field-label mt-3">Audit stream<select className="field" value={stream} onChange={e => { setStream(e.target.value); resetFilters(); }}>
          <option value="business">Business changes</option><option value="authentication">Supabase sign-in / sign-out</option><option value="views">Optional unit opens (30 days)</option>
        </select></label>
        {stream === "authentication" && <p className="mt-2 text-sm text-[#617169]">Provider login and logout records only. Login denotes a provider sign-in record, not proof of success. Refreshes and presence heartbeats are excluded. Database logging is optional; an empty feed does not mean nobody signed in. Local sign-out may have no provider event.</p>}
        {stream === "views" && <><p className="mt-2 text-sm text-[#617169]">Deliberate opens after display; repeats within five minutes are deduplicated. Records expire after 30 days.</p><label className="mt-2 flex gap-2 text-sm"><input type="checkbox" checked={trackingEnabled === true} disabled={trackingEnabled === null} onChange={async e => { const { data,error } = await createSupabaseBrowserClient().rpc("audit_unit_open_setting", { p_enabled: e.target.checked }); if(error) setError(error.message); else setTrackingEnabled(data); }} />Enable unit-open recording</label></>}

        <dl className="mt-4 grid grid-cols-2 divide-x divide-y divide-[#e5e9e4] overflow-hidden rounded-md border border-[#e1e5df] bg-[#FAFBF9] text-sm lg:grid-cols-4 lg:divide-y-0">
          <Summary label="Events on this page" value={String(events.length)} />
          <Summary label="Last 30 days on page" value={String(lastThirtyDays)} />
          <Summary label="Actors on page" value={String(activeUsers)} />
          <Summary label="Latest event" value={latest ? `${eventDate(latest)} · ${eventTime(latest)}` : "No events"} />
        </dl>

        <div className="mt-4 flex gap-1 overflow-x-auto border-b border-[#e1e5df]" aria-label="Audit categories">
          {categories.map((item) => (
            <button
              key={item}
              type="button"
              className={`shrink-0 border-b-2 px-3 py-2 text-sm font-semibold transition ${category === item ? "border-[#D6A23A] text-[#0F3D2E]" : "border-transparent text-[#617169] hover:text-[#0F3D2E]"}`}
              onClick={() => setCategory(item)}
            >
              {item === "all" ? "All" : formatAuditCategory(item)}
            </button>
          ))}
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(15rem,1.5fr)_repeat(3,minmax(9rem,1fr))_auto]">
          <label className="relative min-w-0">
            <span className="sr-only">Search audit log</span>
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#77847d]" />
            <input className={`field w-full pl-9 ${search ? "filter-active" : ""}`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search this page" />
          </label>
          <label className="field-label">Event type<input className="field" list="audit-event-types" value={eventType} onChange={e => setEventType(e.target.value)} placeholder="All events" /><datalist id="audit-event-types">{eventTypes.map(type => <option key={type} value={type} />)}</datalist></label>
          <FilterSelect label="User" value={userId} onChange={setUserId} active={Boolean(userId)}>
            <option value="">All users</option>
            {actors.map((actor) => <option key={actor.id} value={actor.id}>{profileName(actor)}</option>)}
          </FilterSelect>
          <FilterSelect label="Date range" value={dateRange} onChange={(value) => setDateRange(value as DateRange)} active={Boolean(dateRange)}>
            <option value="">Any date</option>
            <option value="today">Today</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </FilterSelect>
          <button type="button" className="secondary min-h-10 whitespace-nowrap px-3 disabled:opacity-40" onClick={resetFilters} disabled={!hasFilters}>Reset</button>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {!buildingContextId && <FilterSelect label="Building" value={buildingId} onChange={setBuildingId} active={Boolean(buildingId)}><option value="">All buildings</option>{buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</FilterSelect>}
          <FilterSelect label="Unit" value={unitId} onChange={setUnitId} active={Boolean(unitId)}><option value="">All units</option>{units.filter(u => !(buildingContextId || buildingId) || u.building_id === (buildingContextId || buildingId)).map(u => <option key={u.id} value={u.id}>{u.unit_number}</option>)}</FilterSelect>
          <label className="field-label">Sale ID<input className="field" value={saleId} onChange={e => setSaleId(e.target.value)} placeholder="Sale UUID" /></label>
          <label className="field-label">Snag ID<input className="field" value={snagId} onChange={e => setSnagId(e.target.value)} placeholder="Snag UUID" /></label>
          <label className="field-label">From date<input className="field" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} /></label>
          <label className="field-label">To date (inclusive)<input className="field" type="date" value={toDate} onChange={e => setToDate(e.target.value)} /></label>
        </div>
        <p className="mt-2 text-xs text-[#6A7770]" aria-live="polite">{loading ? "Loading audit page…" : `${filtered.length} events shown · page ${cursors.length}`}</p>
        {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      </div>

      <div className="grid gap-3 bg-[#F7F5EF] p-3 md:hidden">
        {filtered.map((row) => {
          const Icon = eventIcon(row.category);
          return (
            <button key={row.event.id} type="button" onClick={() => setSelectedEvent(row.event)} className="mobile-card w-full text-left transition hover:border-[#bfc9c1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F3D2E]">
              <div className="flex items-start gap-3">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#47705f]" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-[#1F2A24]">{formatAuditEventType(row.event.event_type)}</p>
                  <p className="mt-0.5 text-xs text-[#6A7770]">{eventDate(row.event.created_at)} · {eventTime(row.event.created_at)} · {formatAuditCategory(row.category)}</p>
                </div>
              </div>
              <p className="mt-3 font-medium text-[#26342d]">{row.subject.primary}</p>
              {row.subject.secondary && <p className="text-xs text-[#6A7770]">{row.subject.secondary}</p>}
              <p className="mt-2 text-sm text-[#435149]">{row.change}</p>
              <p className="mt-3 border-t border-[#e5e9e4] pt-2 text-xs text-[#6A7770]">Changed by {row.actor.name}</p>
            </button>
          );
        })}
        {!filtered.length && <EmptyState hasFilters={hasFilters} onReset={resetFilters} />}
      </div>

      <div className="hidden md:block">
        <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-[#617169]">
              <th className="w-[15%] border-b border-[#d9ded6] px-4 py-2.5">Date</th>
              <th className="w-[23%] border-b border-[#d9ded6] px-3 py-2.5">Activity</th>
              <th className="w-[20%] border-b border-[#d9ded6] px-3 py-2.5">Subject</th>
              <th className="w-[27%] border-b border-[#d9ded6] px-3 py-2.5">Change</th>
              <th className="w-[15%] border-b border-[#d9ded6] px-3 py-2.5">User</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const Icon = eventIcon(row.category);
              return (
                <tr key={row.event.id} tabIndex={0} role="button" onClick={() => setSelectedEvent(row.event)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedEvent(row.event); }} className="cursor-pointer outline-none transition hover:bg-[#FAFBF9] focus-visible:bg-[#F3F7F4]">
                  <td className="border-b border-[#e5e9e4] px-4 py-3 align-top"><span className="block whitespace-nowrap font-medium">{eventDate(row.event.created_at)}</span><span className="text-xs text-[#6A7770]">{eventTime(row.event.created_at)}</span></td>
                  <td className="border-b border-[#e5e9e4] px-3 py-3 align-top"><span className="flex gap-2"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#47705f]" /><span><span className="block font-semibold text-[#26342d]">{formatAuditEventType(row.event.event_type)}</span><span className="text-xs text-[#6A7770]">{formatAuditCategory(row.category)}</span></span></span></td>
                  <td className="border-b border-[#e5e9e4] px-3 py-3 align-top"><span className="block truncate font-medium text-[#26342d]">{row.subject.primary}</span>{row.subject.secondary && <span className="block truncate text-xs text-[#6A7770]">{row.subject.secondary}</span>}</td>
                  <td className="border-b border-[#e5e9e4] px-3 py-3 align-top text-[#435149]"><span className="line-clamp-2">{row.change}</span></td>
                  <td className="border-b border-[#e5e9e4] px-3 py-3 align-top"><span className="block truncate font-medium">{row.actor.name}</span>{row.actor.organisation && <span className="block truncate text-xs text-[#6A7770]">{row.actor.organisation}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!filtered.length && <EmptyState hasFilters={hasFilters} onReset={resetFilters} />}
      </div>

      <nav className="flex justify-between border-t border-[#d9ded6] p-3" aria-label="Audit pagination">
        <button className="secondary" disabled={loading || cursors.length === 1} onClick={() => setCursors(c => c.slice(0,-1))}>Previous</button>
        <button className="secondary" disabled={loading || !hasNext} onClick={() => { const last=events[events.length-1]; if(last) setCursors(c => [...c,{ time:last.created_at,id:last.id,source:last.source ?? "" }]); }}>Next</button>
      </nav>
      {selectedEvent && <AuditDrawer event={selectedEvent} context={context} onClose={() => setSelectedEvent(null)} />}
    </section>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 px-3 py-2.5"><dt className="text-xs text-[#6A7770]">{label}</dt><dd className="mt-0.5 truncate font-semibold text-[#26342d]">{value}</dd></div>;
}

function FilterSelect({ label, value, active, onChange, children }: { label: string; value: string; active: boolean; onChange: (value: string) => void; children: React.ReactNode }) {
  return <label><span className="sr-only">{label}</span><select className={`field w-full ${active ? "filter-active" : ""}`} value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></label>;
}

function EmptyState({ hasFilters, onReset }: { hasFilters: boolean; onReset: () => void }) {
  return <div className="p-8 text-center text-sm text-[#617169]"><p>{hasFilters ? "No audit events match these filters." : "No audit events have been recorded yet."}</p>{hasFilters && <button type="button" className="mt-3 font-semibold text-[#0F3D2E] underline underline-offset-2" onClick={onReset}>Clear filters</button>}</div>;
}

function AuditDrawer({ event, context, onClose }: { event: AuditEvent; context: AuditContext; onClose: () => void }) {
  const subject = getAuditSubject(event, context);
  const actor = actorDetails(event, context);
  const category = getAuditCategory(event);
  const changes = getAuditChanges(event);
  const metadata = sanitizeAuditMetadata(event.metadata ?? {});
  const source = event.source ?? (typeof event.metadata?.source === "string" ? event.metadata.source : null);
  const reason = typeof event.metadata?.reason === "string" ? event.metadata.reason : null;
  const identifiers = [
    ["Event ID", event.id],
    ["Actor ID", event.created_by_user_id],
    ["Object ID", event.entity_id],
    ["Building ID", event.building_id],
    ["Unit ID", event.unit_id],
    ["Action ID", event.action_id ?? (typeof event.metadata?.batch_identifier === "string" ? event.metadata.batch_identifier : null)],
    ["Source", source],
    ["Outcome", event.outcome],
    ["Actor role at event", event.actor_role],
    ["Reason", reason],
  ].filter((item): item is [string, string] => Boolean(item[1]));

  return (
    <div className="fixed inset-0 z-[80] bg-black/25" onMouseDown={(mouseEvent) => { if (mouseEvent.target === mouseEvent.currentTarget) onClose(); }}>
      <aside role="dialog" aria-modal="true" aria-labelledby="audit-drawer-title" className="ml-auto flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-[#d9ded6] px-5 py-4">
          <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-[#617169]">{formatAuditCategory(category)} · Audit event</p><h3 id="audit-drawer-title" className="mt-1 text-xl font-semibold text-[#1F2A24]">{formatAuditEventType(event.event_type)}</h3></div>
          <button type="button" aria-label="Close audit details" className="rounded-md p-2 text-[#617169] hover:bg-[#F3F5F2] hover:text-[#1F2A24]" onClick={onClose}><X className="h-5 w-5" /></button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <section className="rounded-md border border-[#dce2dc] bg-[#FAFBF9] p-4">
            <p className="font-semibold text-[#26342d]">{subject.primary}</p>
            {subject.secondary && <p className="mt-0.5 text-sm text-[#617169]">{subject.secondary}</p>}
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-[#6A7770]">Changed by</dt><dd className="font-medium">{actor.name}</dd>{actor.organisation && <dd className="text-xs text-[#6A7770]">{actor.organisation}</dd>}</div>
              <div><dt className="text-xs text-[#6A7770]">Date and time</dt><dd className="font-medium">{eventDate(event.created_at, true)}</dd></div>
            </dl>
          </section>

          <section className="mt-6">
            <h4 className="text-sm font-semibold text-[#26342d]">What changed</h4>
            {changes.length ? <div className="mt-2 overflow-hidden rounded-md border border-[#dce2dc]">
              {changes.map((change, index) => <div key={`${change.field}-${index}`} className="grid gap-2 border-b border-[#e5e9e4] p-3 last:border-0 sm:grid-cols-[8rem_1fr] sm:gap-4"><p className="text-xs font-semibold text-[#617169]">{change.field}</p><div className="flex min-w-0 items-center gap-2 text-sm"><span className="min-w-0 break-words text-[#657169]">{formatAuditValue(change.previous, change.field.toLowerCase())}</span><ArrowRight className="h-3.5 w-3.5 shrink-0 text-[#829087]" /><span className="min-w-0 break-words font-semibold text-[#26342d]">{formatAuditValue(change.next, change.field.toLowerCase())}</span></div></div>)}
            </div> : <p className="mt-2 rounded-md border border-[#dce2dc] bg-[#FAFBF9] p-3 text-sm text-[#435149]">{auditChangeSummary(event, changes)}</p>}
          </section>

          {identifiers.length > 0 && <section className="mt-6"><h4 className="text-sm font-semibold text-[#26342d]">Event details</h4><dl className="mt-2 grid gap-2 rounded-md border border-[#dce2dc] p-3 text-sm">{identifiers.map(([label, value]) => <div key={label} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3"><dt className="text-[#6A7770]">{label}</dt><dd className="break-all font-medium text-[#34413a]">{value}</dd></div>)}</dl></section>}

          {Object.keys(metadata as Record<string, unknown>).length > 0 && <details className="mt-6 rounded-md border border-[#dce2dc]"><summary className="cursor-pointer px-3 py-2.5 text-sm font-semibold text-[#435149]">Technical details</summary><pre className="overflow-x-auto border-t border-[#e5e9e4] bg-[#F7F8F6] p-3 text-xs leading-relaxed text-[#526158]">{JSON.stringify(metadata, null, 2)}</pre></details>}
        </div>
      </aside>
    </div>
  );
}
