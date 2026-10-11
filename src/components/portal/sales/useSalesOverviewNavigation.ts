"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { readSalesOverviewFilters, writeSalesOverviewFilters, type SalesOverviewFilters } from "@/lib/sales/developer-overview";

const eventName = "sales-overview-navigation";
function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener); window.addEventListener(eventName, listener);
  return () => { window.removeEventListener("popstate", listener); window.removeEventListener(eventName, listener); };
}
const snapshot = () => window.location.search + window.location.hash;
const serverSnapshot = () => "";

export function useSalesOverviewNavigation(enabled: boolean, ready: boolean, selected: string) {
  const location = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const filters = useMemo(() => readSalesOverviewFilters(location.split("#")[0]), [location]);
  useEffect(() => {
    if (!enabled || !ready || selected || new URLSearchParams(window.location.search).has("salesUnitId")) return;
    const frame = requestAnimationFrame(() => {
      const scroll = window.history.state?.salesScroll;
      if (typeof scroll === "number") window.scrollTo({ top: scroll, behavior: "instant" });
      else if (window.location.hash === "#sales-results") document.getElementById("sales-results")?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [enabled, ready, selected, location]);

  function update(next: SalesOverviewFilters) {
    const params = new URLSearchParams(window.location.search);
    writeSalesOverviewFilters(params, next);
    window.history.replaceState({ ...window.history.state, salesScroll: undefined }, "", `/?${params}${window.location.hash}`);
    window.dispatchEvent(new Event(eventName));
  }
  function open(href: string) {
    const returnTo = { url: `${window.location.pathname}${window.location.search}${window.location.hash}`, scroll: window.scrollY };
    window.history.replaceState({ ...window.history.state, salesScroll: window.scrollY }, "");
    window.history.pushState({ salesOverviewReturn: returnTo }, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function back() {
    const saved = window.history.state?.salesOverviewReturn;
    // Only accept a local Sales URL from this history entry, never a redirect.
    if (!saved || typeof saved.url !== "string" || !saved.url.startsWith("/?") || new URLSearchParams(saved.url.split("#")[0].slice(2)).get("screen") !== "sales") return false;
    window.history.pushState({ salesScroll: saved.scroll }, "", saved.url);
    window.dispatchEvent(new PopStateEvent("popstate"));
    return true;
  }
  return { filters, update, open, back, search: location.split("#")[0] };
}
