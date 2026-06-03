"use client";

import {
  Camera,
  Download,
  Eraser,
  LogIn,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Shield,
  Trash2,
} from "lucide-react";
import { jsPDF } from "jspdf";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { User } from "@supabase/supabase-js";
import {
  demoSnags,
  flats,
  type Flat,
  type Snag,
  type SnagStatus,
  type UserRole,
} from "@/lib/data/demo";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

const statuses: SnagStatus[] = ["Open", "Pending", "Resolved"];

type Stroke = {
  points: { x: number; y: number }[];
  color: string;
  width: number;
};

type SnagDraft = {
  flatId: string;
  title: string;
  description: string;
  priority: 1 | 2 | 3;
  imageDataUrl?: string;
};

type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
};

const emptyDraft: SnagDraft = {
  flatId: flats[0].id,
  title: "",
  description: "",
  priority: 2,
};

function flatFor(flatId: string) {
  return flats.find((flat) => flat.id === flatId) ?? flats[0];
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function priorityLabel(priority: Snag["priority"]) {
  return priority === 1 ? "High" : priority === 2 ? "Medium" : "Low";
}

export function PortalApp() {
  const supabaseEnabled = isSupabaseConfigured();
  const [demoRole, setDemoRole] = useState<UserRole>("admin");
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [availableFlats, setAvailableFlats] = useState<Flat[]>(flats);
  const [snags, setSnags] = useState<Snag[]>(demoSnags);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | SnagStatus>("All");
  const [priorityFilter, setPriorityFilter] = useState<"All" | "1" | "2" | "3">("All");
  const [reportFlatId, setReportFlatId] = useState(flats[0].id);
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [draft, setDraft] = useState<SnagDraft>(emptyDraft);
  const [editing, setEditing] = useState<Snag | null>(null);
  const [isLoading, setIsLoading] = useState(supabaseEnabled);
  const [notice, setNotice] = useState("");
  const role = supabaseEnabled ? profile?.role ?? "user" : demoRole;

  useEffect(() => {
    if (supabaseEnabled) return;

    const saved = window.localStorage.getItem("bunnywell-snags");

    if (saved) {
      setSnags(JSON.parse(saved) as Snag[]);
    }
  }, [supabaseEnabled]);

  useEffect(() => {
    if (supabaseEnabled) return;

    window.localStorage.setItem("bunnywell-snags", JSON.stringify(snags));
  }, [snags, supabaseEnabled]);

  useEffect(() => {
    if (!supabaseEnabled) return;

    const supabase = createSupabaseBrowserClient();

    supabase.auth.getUser().then(async ({ data }) => {
      setUser(data.user);

      if (data.user) {
        await loadSupabaseData(data.user);
      }

      setIsLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);

      if (session?.user) {
        void loadSupabaseData(session.user);
      } else {
        setProfile(null);
        setSnags([]);
        setAvailableFlats(flats);
      }
    });

    return () => data.subscription.unsubscribe();
  }, [supabaseEnabled]);

  function findFlat(flatId: string) {
    return availableFlats.find((flat) => flat.id === flatId) ?? availableFlats[0] ?? flats[0];
  }

  async function loadSupabaseData(currentUser = user) {
    if (!currentUser) return;

    const supabase = createSupabaseBrowserClient();
    const [{ data: profileData }, { data: flatRows }, { data: snagRows, error }] = await Promise.all([
      supabase.from("profiles").select("id,email,full_name,role").eq("id", currentUser.id).single(),
      supabase.from("flats").select("id,flat_reference,building_name").order("flat_reference"),
      supabase
        .from("snags")
        .select("id,flat_id,title,description,status,priority,image_path,created_at,profiles:created_by(full_name,email)")
        .order("created_at", { ascending: false }),
    ]);

    if (error) {
      setNotice(error.message);
    }

    const nextFlats =
      flatRows?.map((flat) => ({
        id: flat.id,
        flatReference: flat.flat_reference,
        buildingName: flat.building_name,
      })) ?? flats;

    setProfile(
      (profileData as Profile | null) ?? {
        id: currentUser.id,
        email: currentUser.email ?? "",
        full_name: currentUser.email ?? "User",
        role: "user",
      },
    );
    setAvailableFlats(nextFlats);
    setDraft((current) => ({ ...current, flatId: nextFlats[0]?.id ?? current.flatId }));
    setReportFlatId((current) => nextFlats.find((flat) => flat.id === current)?.id ?? nextFlats[0]?.id ?? current);
    setSnags(
      snagRows?.map((snag) => {
        const profileRow = Array.isArray(snag.profiles) ? snag.profiles[0] : snag.profiles;

        return {
          id: snag.id,
          flatId: snag.flat_id,
          title: snag.title,
          description: snag.description ?? "",
          status: snag.status as SnagStatus,
          priority: snag.priority as 1 | 2 | 3,
          createdAt: snag.created_at,
          createdBy: profileRow?.full_name ?? profileRow?.email ?? "User",
          imagePath: snag.image_path ?? undefined,
          imageDataUrl: snag.image_path
            ? supabase.storage.from("snag-images").getPublicUrl(snag.image_path).data.publicUrl
            : undefined,
        };
      }) ?? [],
    );
  }

  const filteredSnags = useMemo(() => {
    const normalQuery = query.trim().toLowerCase();

    return snags.filter((snag) => {
      const flat = findFlat(snag.flatId);
      const matchesQuery =
        normalQuery.length === 0 ||
        snag.title.toLowerCase().includes(normalQuery) ||
        flat.flatReference.toLowerCase().includes(normalQuery) ||
        flat.buildingName.toLowerCase().includes(normalQuery);
      const matchesStatus = statusFilter === "All" || snag.status === statusFilter;
      const matchesPriority = priorityFilter === "All" || String(snag.priority) === priorityFilter;

      return matchesQuery && matchesStatus && matchesPriority;
    });
  }, [availableFlats, priorityFilter, query, snags, statusFilter]);

  const reportFlat = findFlat(reportFlatId);
  const reportSnags = snags.filter((snag) => snag.flatId === reportFlatId);

  async function createSnag() {
    if (!draft.title.trim()) return;

    if (supabaseEnabled) {
      if (!user) return;

      const supabase = createSupabaseBrowserClient();
      let imagePath: string | undefined;

      try {
        if (draft.imageDataUrl) {
          imagePath = await uploadSnagImage(draft.imageDataUrl, draft.flatId);
        }

        const { error } = await supabase.from("snags").insert({
          flat_id: draft.flatId,
          title: draft.title.trim(),
          description: draft.description.trim(),
          priority: draft.priority,
          status: "Open",
          image_path: imagePath,
          created_by: user.id,
        });

        if (error) {
          setNotice(error.message);
          return;
        }

        setDraft({ ...emptyDraft, flatId: availableFlats[0]?.id ?? emptyDraft.flatId });
        await loadSupabaseData(user);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not create snag.");
      }

      return;
    }

    const newSnag: Snag = {
      id: crypto.randomUUID(),
      flatId: draft.flatId,
      title: draft.title.trim(),
      description: draft.description.trim(),
      priority: draft.priority,
      status: "Open",
      createdAt: new Date().toISOString(),
      createdBy: demoRole === "admin" ? "Site Admin" : "Demo User",
      imageDataUrl: draft.imageDataUrl,
    };

    setSnags((current) => [newSnag, ...current]);
    setDraft(emptyDraft);
  }

  async function updateSnag(next: Snag) {
    if (supabaseEnabled) {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase
        .from("snags")
        .update({
          title: next.title,
          description: next.description,
          priority: next.priority,
          status: next.status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", next.id);

      if (error) {
        setNotice(error.message);
        return;
      }

      setEditing(null);
      await loadSupabaseData(user);
      return;
    }

    setSnags((current) => current.map((snag) => (snag.id === next.id ? next : snag)));
    setEditing(null);
  }

  async function deleteSnag(id: string) {
    if (supabaseEnabled) {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.from("snags").delete().eq("id", id);

      if (error) {
        setNotice(error.message);
        return;
      }

      await loadSupabaseData(user);
      return;
    }

    setSnags((current) => current.filter((snag) => snag.id !== id));
  }

  async function changeStatus(id: string, status: SnagStatus) {
    if (supabaseEnabled) {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase
        .from("snags")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id);

      if (error) {
        setNotice(error.message);
        return;
      }

      await loadSupabaseData(user);
      return;
    }

    setSnags((current) =>
      current.map((snag) => (snag.id === id ? { ...snag, status } : snag)),
    );
  }

  function downloadReport() {
    setIsGeneratingReport(true);
    setReportUrl(null);

    window.setTimeout(async () => {
      try {
        const pdf = new jsPDF({ unit: "pt", format: "a4" });
        const margin = 40;
        let y = margin;

        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(20);
        pdf.text("Bunnywell Portal Snag Report", margin, y);
        y += 30;

        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(11);
        pdf.text(`Flat ${reportFlat.flatReference}, ${reportFlat.buildingName}`, margin, y);
        y += 18;
        pdf.text(`Generated ${formatDate(new Date().toISOString())}`, margin, y);
        y += 28;

        if (reportSnags.length === 0) {
          pdf.text("No snags recorded for this flat.", margin, y);
        }

        for (const snag of reportSnags) {
          if (y > 700) {
            pdf.addPage();
            y = margin;
          }

          pdf.setFont("helvetica", "bold");
          pdf.setFontSize(13);
          pdf.text(snag.title, margin, y);
          y += 18;

          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(10);
          pdf.text(`Status: ${snag.status}    Priority: ${priorityLabel(snag.priority)}`, margin, y);
          y += 16;
          pdf.text(`Created: ${formatDate(snag.createdAt)} by ${snag.createdBy}`, margin, y);
          y += 16;

          const details = pdf.splitTextToSize(snag.description || "No details provided.", 500);
          pdf.text(details, margin, y);
          y += details.length * 13 + 12;

          if (snag.imageDataUrl) {
            try {
              const imageData = snag.imageDataUrl.startsWith("data:")
                ? snag.imageDataUrl
                : await imageUrlToDataUrl(snag.imageDataUrl);
              const imageFormat = imageData.startsWith("data:image/png") ? "PNG" : "JPEG";
              pdf.addImage(imageData, imageFormat, margin, y, 240, 180);
              y += 200;
            } catch {
              pdf.text("Image could not be added to this report.", margin, y);
              y += 20;
            }
          }

          y += 10;
        }

        const filename = `bunnywell-${reportFlat.flatReference}-snag-report.pdf`;
        const blob = pdf.output("blob");
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setReportUrl(url);
      } finally {
        setIsGeneratingReport(false);
      }
    }, 0);
  }

  return (
    <main className="min-h-screen bg-[#f6f7f4]">
      <header className="border-b border-[#d9ded6] bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div>
            <p className="text-sm font-medium text-[#5d6b64]">Forum House</p>
            <h1 className="text-2xl font-semibold tracking-normal text-[#18201c] sm:text-3xl">
              Bunnywell Portal
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-md border border-[#cbd4ce] bg-[#f6f7f4] px-3 py-2 text-sm text-[#34413a]">
              <Shield size={16} aria-hidden />
              {supabaseEnabled ? profile?.email ?? "Supabase session" : "Demo session"}
            </span>
            {!supabaseEnabled && (
              <select
                value={demoRole}
                onChange={(event) => setDemoRole(event.target.value as UserRole)}
                className="h-10 rounded-md border border-[#cbd4ce] bg-white px-3 text-sm"
                aria-label="Demo role"
              >
                <option value="admin">Admin</option>
                <option value="user">Standard user</option>
              </select>
            )}
            {supabaseEnabled && user ? (
              <button
                onClick={() => createSupabaseBrowserClient().auth.signOut()}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-[#2f5d50] px-4 text-sm font-medium text-white"
              >
                <LogIn size={16} aria-hidden />
                Sign out
              </button>
            ) : (
              <button className="inline-flex h-10 items-center gap-2 rounded-md bg-[#2f5d50] px-4 text-sm font-medium text-white">
                <LogIn size={16} aria-hidden />
                {supabaseEnabled ? "Login required" : "Supabase login ready"}
              </button>
            )}
          </div>
        </div>
      </header>

      {notice && (
        <div className="mx-auto mt-4 max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-md border border-[#e2c8a6] bg-[#fff8ec] px-4 py-3 text-sm text-[#735327]">
            {notice}
          </div>
        </div>
      )}

      {supabaseEnabled && isLoading && (
        <div className="mx-auto max-w-7xl px-4 py-8 text-sm text-[#617169] sm:px-6 lg:px-8">
          Loading Bunnywell Portal...
        </div>
      )}

      {supabaseEnabled && !isLoading && !user && <LoginPanel onNotice={setNotice} />}

      {(!supabaseEnabled || user) && (
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:px-8">
        <section className="min-w-0">
          <div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_150px]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#617169]" size={18} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search title, flat, or building"
                className="h-11 w-full rounded-md border border-[#cbd4ce] bg-white pl-10 pr-3 text-sm"
              />
            </label>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "All" | SnagStatus)}
              className="h-11 rounded-md border border-[#cbd4ce] bg-white px-3 text-sm"
              aria-label="Filter by status"
            >
              <option value="All">All statuses</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <select
              value={priorityFilter}
              onChange={(event) => setPriorityFilter(event.target.value as "All" | "1" | "2" | "3")}
              className="h-11 rounded-md border border-[#cbd4ce] bg-white px-3 text-sm"
              aria-label="Filter by priority"
            >
              <option value="All">All priorities</option>
              <option value="1">High</option>
              <option value="2">Medium</option>
              <option value="3">Low</option>
            </select>
          </div>

          <div className="overflow-hidden rounded-md border border-[#d9ded6] bg-white">
            <div className="grid grid-cols-4 gap-3 border-b border-[#d9ded6] bg-[#eef1ec] px-4 py-3 text-xs font-semibold uppercase text-[#58675f] max-md:hidden">
              <span>Title</span>
              <span>Flat</span>
              <span>Status</span>
              <span>Created</span>
            </div>
            <div className="divide-y divide-[#e5e9e4]">
              {filteredSnags.map((snag) => {
                const flat = findFlat(snag.flatId);

                return (
                  <article key={snag.id} className="grid gap-3 px-4 py-4 md:grid-cols-4 md:items-center">
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold text-[#18201c]">{snag.title}</h2>
                      <p className="mt-1 line-clamp-2 text-sm text-[#617169]">{snag.description}</p>
                      <span className="mt-2 inline-flex rounded-md bg-[#edf4f1] px-2 py-1 text-xs font-medium text-[#2f5d50]">
                        {priorityLabel(snag.priority)} priority
                      </span>
                    </div>
                    <div className="text-sm text-[#34413a]">
                      <span className="font-medium">{flat.flatReference}</span>
                      <p className="text-[#617169]">{flat.buildingName}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {role === "admin" ? (
                        <select
                          value={snag.status}
                          onChange={(event) => changeStatus(snag.id, event.target.value as SnagStatus)}
                          className="h-9 rounded-md border border-[#cbd4ce] bg-white px-2 text-sm"
                          aria-label={`Change status for ${snag.title}`}
                        >
                          {statuses.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <StatusBadge status={snag.status} />
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-3 text-sm text-[#617169]">
                      <span>{formatDate(snag.createdAt)}</span>
                      {role === "admin" && (
                        <span className="flex gap-1">
                          <button
                            onClick={() => setEditing(snag)}
                            className="inline-flex size-9 items-center justify-center rounded-md border border-[#cbd4ce] bg-white text-[#34413a]"
                            aria-label={`Edit ${snag.title}`}
                            title="Edit snag"
                          >
                            <Pencil size={16} aria-hidden />
                          </button>
                          <button
                            onClick={() => deleteSnag(snag.id)}
                            className="inline-flex size-9 items-center justify-center rounded-md border border-[#e1c7c7] bg-white text-[#9c3232]"
                            aria-label={`Delete ${snag.title}`}
                            title="Delete snag"
                          >
                            <Trash2 size={16} aria-hidden />
                          </button>
                        </span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <aside className="space-y-6">
          <section className="rounded-md border border-[#d9ded6] bg-white p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-[#18201c]">Create snag</h2>
              <Plus size={20} className="text-[#2f5d50]" aria-hidden />
            </div>
            <SnagForm
              draft={draft}
              flats={availableFlats}
              setDraft={setDraft}
              onSubmit={createSnag}
              buttonLabel="Create snag"
            />
          </section>

          <section className="rounded-md border border-[#d9ded6] bg-white p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-[#18201c]">Flat report</h2>
              <Download size={20} className="text-[#2f5d50]" aria-hidden />
            </div>
            <div className="space-y-3">
              <select
                value={reportFlatId}
                onChange={(event) => setReportFlatId(event.target.value)}
                className="h-11 w-full rounded-md border border-[#cbd4ce] bg-white px-3 text-sm"
                aria-label="Select flat for report"
              >
                {availableFlats.map((flat) => (
                  <option key={flat.id} value={flat.id}>
                    {flat.flatReference} - {flat.buildingName}
                  </option>
                ))}
              </select>
              <p className="text-sm text-[#617169]">
                {reportSnags.length} snag{reportSnags.length === 1 ? "" : "s"} will be included for flat{" "}
                {reportFlat.flatReference}.
              </p>
              <button
                onClick={downloadReport}
                disabled={isGeneratingReport}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#2f5d50] px-4 text-sm font-semibold text-white transition hover:bg-[#264d42] disabled:cursor-wait disabled:opacity-70"
              >
                <Download size={17} aria-hidden />
                {isGeneratingReport ? "Preparing report" : "Download PDF"}
              </button>
              {reportUrl && (
                <a
                  href={reportUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-md border border-[#cbd4ce] px-3 py-2 text-center text-sm font-medium text-[#2f5d50]"
                >
                  Open generated report
                </a>
              )}
            </div>
          </section>

          {supabaseEnabled && role === "admin" && <AdminUserCreator onNotice={setNotice} />}
        </aside>
      </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-20 grid place-items-center bg-black/35 p-4">
          <section className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-md bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Edit snag</h2>
              <button onClick={() => setEditing(null)} className="rounded-md border border-[#cbd4ce] px-3 py-2 text-sm">
                Close
              </button>
            </div>
            <AdminEditForm snag={editing} onSubmit={updateSnag} />
          </section>
        </div>
      )}
    </main>
  );
}

async function uploadSnagImage(imageDataUrl: string, flatId: string) {
  const supabase = createSupabaseBrowserClient();
  const response = await fetch(imageDataUrl);
  const blob = await response.blob();
  const filePath = `${flatId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from("snag-images").upload(filePath, blob, {
    contentType: "image/jpeg",
    upsert: false,
  });

  if (error) throw error;

  return filePath;
}

async function imageUrlToDataUrl(url: string) {
  const response = await fetch(url);
  const blob = await response.blob();

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function LoginPanel({ onNotice }: { onNotice: (notice: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function login() {
    setIsSubmitting(true);
    onNotice("");

    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) onNotice(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-md gap-4 px-4 py-10">
      <section className="rounded-md border border-[#d9ded6] bg-white p-5">
        <h2 className="text-lg font-semibold text-[#18201c]">Sign in</h2>
        <div className="mt-4 space-y-3">
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            type="email"
            className="h-11 w-full rounded-md border border-[#cbd4ce] bg-white px-3 text-sm"
          />
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            type="password"
            className="h-11 w-full rounded-md border border-[#cbd4ce] bg-white px-3 text-sm"
          />
          <button
            onClick={login}
            disabled={!email || !password || isSubmitting}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#2f5d50] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LogIn size={17} aria-hidden />
            {isSubmitting ? "Signing in" : "Sign in"}
          </button>
        </div>
      </section>
    </div>
  );
}

function AdminUserCreator({ onNotice }: { onNotice: (notice: string) => void }) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("user");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function createUser() {
    setIsSubmitting(true);
    onNotice("");

    try {
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ email, password, fullName, role }),
      });
      const payload = (await response.json()) as { error?: string; email?: string };

      if (!response.ok) {
        onNotice(payload.error ?? "Could not create user.");
        return;
      }

      setEmail("");
      setFullName("");
      setPassword("");
      setRole("user");
      onNotice(`Created user ${payload.email}.`);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="rounded-md border border-[#d9ded6] bg-white p-4">
      <h2 className="text-lg font-semibold text-[#18201c]">Create user</h2>
      <div className="mt-4 space-y-3">
        <input
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          placeholder="Full name"
          className="h-11 w-full rounded-md border border-[#cbd4ce] bg-white px-3 text-sm"
        />
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email"
          type="email"
          className="h-11 w-full rounded-md border border-[#cbd4ce] bg-white px-3 text-sm"
        />
        <input
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Temporary password"
          type="password"
          className="h-11 w-full rounded-md border border-[#cbd4ce] bg-white px-3 text-sm"
        />
        <select
          value={role}
          onChange={(event) => setRole(event.target.value as UserRole)}
          className="h-11 w-full rounded-md border border-[#cbd4ce] bg-white px-3 text-sm"
        >
          <option value="user">Standard user</option>
          <option value="admin">Admin</option>
        </select>
        <button
          onClick={createUser}
          disabled={!email || !password || isSubmitting}
          className="h-11 w-full rounded-md bg-[#2f5d50] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Creating user" : "Create user"}
        </button>
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: SnagStatus }) {
  const classes = {
    Open: "bg-[#f5eee3] text-[#735327]",
    Pending: "bg-[#edf1f7] text-[#354f75]",
    Resolved: "bg-[#e7f3ea] text-[#2f623c]",
  };

  return <span className={`rounded-md px-2 py-1 text-xs font-semibold ${classes[status]}`}>{status}</span>;
}

function SnagForm({
  draft,
  flats,
  setDraft,
  onSubmit,
  buttonLabel,
}: {
  draft: SnagDraft;
  flats: Flat[];
  setDraft: (draft: SnagDraft) => void;
  onSubmit: () => void | Promise<void>;
  buttonLabel: string;
}) {
  return (
    <div className="space-y-3">
      <select
        value={draft.flatId}
        onChange={(event) => setDraft({ ...draft, flatId: event.target.value })}
        className="h-11 w-full rounded-md border border-[#cbd4ce] bg-white px-3 text-sm"
        aria-label="Flat"
      >
        {flats.map((flat) => (
          <option key={flat.id} value={flat.id}>
            {flat.flatReference} - {flat.buildingName}
          </option>
        ))}
      </select>
      <input
        value={draft.title}
        onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        placeholder="Snag title"
        className="h-11 w-full rounded-md border border-[#cbd4ce] bg-white px-3 text-sm"
      />
      <textarea
        value={draft.description}
        onChange={(event) => setDraft({ ...draft, description: event.target.value })}
        placeholder="Details"
        rows={3}
        className="w-full resize-none rounded-md border border-[#cbd4ce] bg-white px-3 py-3 text-sm"
      />
      <select
        value={draft.priority}
        onChange={(event) => setDraft({ ...draft, priority: Number(event.target.value) as 1 | 2 | 3 })}
        className="h-11 w-full rounded-md border border-[#cbd4ce] bg-white px-3 text-sm"
        aria-label="Priority"
      >
        <option value={1}>High priority</option>
        <option value={2}>Medium priority</option>
        <option value={3}>Low priority</option>
      </select>
      <PhotoAnnotator imageDataUrl={draft.imageDataUrl} onChange={(imageDataUrl) => setDraft({ ...draft, imageDataUrl })} />
      <button
        onClick={onSubmit}
        disabled={!draft.title.trim()}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#2f5d50] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus size={17} aria-hidden />
        {buttonLabel}
      </button>
    </div>
  );
}

function AdminEditForm({ snag, onSubmit }: { snag: Snag; onSubmit: (snag: Snag) => void | Promise<void> }) {
  const [draft, setDraft] = useState(snag);

  return (
    <div className="space-y-3">
      <input
        value={draft.title}
        onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        className="h-11 w-full rounded-md border border-[#cbd4ce] bg-white px-3 text-sm"
      />
      <textarea
        value={draft.description}
        onChange={(event) => setDraft({ ...draft, description: event.target.value })}
        rows={4}
        className="w-full resize-none rounded-md border border-[#cbd4ce] bg-white px-3 py-3 text-sm"
      />
      <select
        value={draft.priority}
        onChange={(event) => setDraft({ ...draft, priority: Number(event.target.value) as 1 | 2 | 3 })}
        className="h-11 w-full rounded-md border border-[#cbd4ce] bg-white px-3 text-sm"
      >
        <option value={1}>High priority</option>
        <option value={2}>Medium priority</option>
        <option value={3}>Low priority</option>
      </select>
      <select
        value={draft.status}
        onChange={(event) => setDraft({ ...draft, status: event.target.value as SnagStatus })}
        className="h-11 w-full rounded-md border border-[#cbd4ce] bg-white px-3 text-sm"
      >
        {statuses.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
      <button
        onClick={() => onSubmit(draft)}
        className="h-11 w-full rounded-md bg-[#2f5d50] px-4 text-sm font-semibold text-white"
      >
        Save changes
      </button>
    </div>
  );
}

function PhotoAnnotator({
  imageDataUrl,
  onChange,
}: {
  imageDataUrl?: string;
  onChange: (imageDataUrl?: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [baseImageDataUrl, setBaseImageDataUrl] = useState<string | undefined>(imageDataUrl);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [drawing, setDrawing] = useState(false);

  useEffect(() => {
    if (!baseImageDataUrl) {
      imageRef.current = null;
      return;
    }

    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      redraw(strokes, image);
    };
    image.src = baseImageDataUrl;
  }, [baseImageDataUrl]);

  useEffect(() => {
    redraw(strokes);
  }, [strokes]);

  function redraw(nextStrokes = strokes, image = imageRef.current) {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    canvas.width = 720;
    canvas.height = Math.max(360, Math.round((image.height / image.width) * canvas.width));
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const stroke of nextStrokes) {
      context.strokeStyle = stroke.color;
      context.lineWidth = stroke.width;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      stroke.points.forEach((point, index) => {
        if (index === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      });
      context.stroke();
    }

    onChange(canvas.toDataURL("image/jpeg", 0.82));
  }

  function canvasPoint(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function handleUpload(file?: File) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setStrokes([]);
      setBaseImageDataUrl(String(reader.result));
      onChange(String(reader.result));
    };
    reader.readAsDataURL(file);
  }

  function undo() {
    const next = strokes.slice(0, -1);
    setStrokes(next);
    redraw(next);
  }

  function clear() {
    setStrokes([]);
    redraw([]);
  }

  return (
    <div className="space-y-3">
      <label className="inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-[#9dafaa] bg-[#f6f7f4] px-4 text-sm font-medium text-[#34413a]">
        <Camera size={17} aria-hidden />
        Add or take photo
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(event) => handleUpload(event.target.files?.[0])}
        />
      </label>

      {imageDataUrl && (
        <div className="space-y-2">
          <canvas
            ref={canvasRef}
            className="aspect-video w-full rounded-md border border-[#cbd4ce] bg-[#eef1ec] object-contain"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setDrawing(true);
              setStrokes((current) => [...current, { color: "#d33f2f", width: 8, points: [canvasPoint(event)] }]);
            }}
            onPointerMove={(event) => {
              if (!drawing) return;
              setStrokes((current) => {
                const next = [...current];
                const latest = next[next.length - 1];
                next[next.length - 1] = { ...latest, points: [...latest.points, canvasPoint(event)] };
                return next;
              });
            }}
            onPointerUp={() => setDrawing(false)}
            onPointerCancel={() => setDrawing(false)}
            aria-label="Photo annotation canvas"
          />
          <div className="grid grid-cols-3 gap-2">
            <button onClick={undo} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#cbd4ce] text-sm">
              <RotateCcw size={16} aria-hidden />
              Undo
            </button>
            <button onClick={clear} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#cbd4ce] text-sm">
              <Eraser size={16} aria-hidden />
              Clear
            </button>
            <button
              onClick={() => {
                setBaseImageDataUrl(undefined);
                setStrokes([]);
                onChange(undefined);
              }}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#e1c7c7] text-sm text-[#9c3232]"
            >
              <Trash2 size={16} aria-hidden />
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
