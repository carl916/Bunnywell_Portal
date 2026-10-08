"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createSalesRegisterSession, RegisterAccessError } from "@/lib/sales/register-session";

// The owner is keyed by identity, building and known access membership before render.
export function useSalesRegister(identity: string, buildingId: string, visible: boolean, refreshKey?: string | null) {
  const [session] = useState(() => createSalesRegisterSession(async signal => {
    const { data } = await createSupabaseBrowserClient().auth.getSession();
    if (!data.session || data.session.user.id !== identity.split(":")[0]) throw new RegisterAccessError("Sign in again to see Sales.");
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const response = await fetch(`/api/sales/register?building=${encodeURIComponent(buildingId || "all")}`, {
      headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store", signal,
    });
    // Clear protected data even when a revoked response has no JSON body.
    if ([401, 403].includes(response.status)) throw new RegisterAccessError("Sales access unavailable. Reload the portal to verify your access.");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Sales information unavailable.");
    if (result.scope?.identity !== identity || result.scope?.buildingId !== buildingId || !Array.isArray(result.rows)) throw new RegisterAccessError("Sales scope changed. Reload the portal.");
    return result;
  }));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => {
    session.start();
    const auth = createSupabaseBrowserClient().auth.onAuthStateChange((event, value) => {
      if (event === "SIGNED_OUT" || !value || value.user.id !== identity.split(":")[0]) session.revoke();
    });
    window.addEventListener("focus", session.wake);
    window.addEventListener("online", session.online);
    document.addEventListener("visibilitychange", session.wake);
    window.addEventListener("sale-activity-changed", session.invalidate);
    window.addEventListener("portal-work-changed", session.invalidate);
    return () => {
      session.stop(); auth.data.subscription.unsubscribe();
      window.removeEventListener("focus", session.wake);
      window.removeEventListener("online", session.online);
      document.removeEventListener("visibilitychange", session.wake);
      window.removeEventListener("sale-activity-changed", session.invalidate);
      window.removeEventListener("portal-work-changed", session.invalidate);
    };
  }, [identity, session]);
  useEffect(() => { session.show(visible); }, [session, visible]);
  const previousRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (previousRefreshKey.current === refreshKey) return;
    previousRefreshKey.current = refreshKey;
    session.refreshNow();
  }, [session, refreshKey]);
  return state;
}
