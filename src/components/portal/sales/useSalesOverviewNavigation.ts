"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { readSalesOverviewFilters, writeSalesOverviewFilters, type SalesOverviewFilters } from "@/lib/sales/developer-overview";

const eventName = "sales-overview-navigation";
type Intent = "arrival" | "history" | "filter" | "page";
let revision = 0;
let intent: Intent = "arrival";
let eventLocation = "";
let consumed = "";
const listeners = new Set<() => void>();
const currentLocation = () => window.location.search + window.location.hash;
const currentUrl = () => window.location.pathname + currentLocation();
const snapshot = () => `${revision}\n${currentLocation()}`;
const serverSnapshot = () => "0\n";

function onNavigation(event: Event) {
  const next = (event as CustomEvent<{ intent?: Intent | "clamp" }>).detail?.intent;
  // A page clamp retains a pending arrival/return, but never replays a consumed
  // scroll. Filtering always cancels pending scrolling, including on slow loads.
  intent = next === "clamp" ? consumed === snapshot() ? "filter" : intent
    : event.type === "popstate" ? "history" : next ?? "arrival";
  eventLocation = currentLocation();
  revision++;
  listeners.forEach(listener => listener());
}

function scrollContainers(element: Element) {
  const containers: HTMLElement[] = [];
  for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) containers.push(parent);
  }
  return containers;
}
function listPosition() {
  const id = new URLSearchParams(window.location.search).get("salesView") === "agent_fees" ? "fee-results" : "sales-results";
  const list = document.getElementById(id);
  return { scroll: window.scrollY, containers: list ? scrollContainers(list).map(element => element.scrollTop) : [] };
}
function saveBeforeUnload() {
  if (new URLSearchParams(window.location.search).has("salesUnitId")) return;
  const position = listPosition();
  window.history.replaceState({ ...window.history.state, salesScroll: position.scroll, salesScrollContainers: position.containers }, "");
}
function subscribe(listener: () => void) {
  if (!listeners.size) {
    window.addEventListener("popstate", onNavigation);
    window.addEventListener(eventName, onNavigation);
    window.addEventListener("pagehide", saveBeforeUnload);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      window.removeEventListener("popstate", onNavigation);
      window.removeEventListener(eventName, onNavigation);
      window.removeEventListener("pagehide", saveBeforeUnload);
    }
  };
}

export function replaceSalesListUrl(url: string, nextIntent: "filter" | "page" | "clamp" = "filter") {
  const effectiveIntent = nextIntent === "clamp" && consumed === snapshot() ? "filter" : nextIntent;
  window.history.replaceState({ ...window.history.state,
    ...(effectiveIntent !== "clamp" ? { salesScroll: undefined, salesScrollContainers: undefined } : {}),
    ...(effectiveIntent === "filter" ? { salesListVisited: url } : {}) }, "", url);
  window.dispatchEvent(new CustomEvent(eventName, { detail: { intent: effectiveIntent } }));
}

export function useSalesOverviewNavigation(enabled: boolean, ready: boolean, selected: string, listId = "sales-results") {
  const request = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const location = request.slice(request.indexOf("\n") + 1);
  const filters = useMemo(() => readSalesOverviewFilters(location.split("#")[0]), [location]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const activeList = params.get("salesView") === "agent_fees" ? "fee-results" : "sales-results";
    if (!enabled || !ready || selected || params.has("salesUnitId") || activeList !== listId) return;
    const frame = requestAnimationFrame(() => {
      if (snapshot() !== request || consumed === request) return;
      const element = document.getElementById(listId);
      if (!element) return;
      consumed = request;
      const requestedIntent = eventLocation === currentLocation() ? intent : "arrival";
      if (requestedIntent === "filter") return;
      const state = window.history.state;
      const scroll = state?.salesScroll;
      const restore = requestedIntent !== "page" && typeof scroll === "number" && Number.isFinite(scroll);
      if (restore) {
        window.scrollTo({ top: Math.max(0, scroll), behavior: "instant" });
        scrollContainers(element).forEach((container, index) => {
          const top = state?.salesScrollContainers?.[index];
          if (typeof top === "number" && Number.isFinite(top)) container.scrollTo({ top: Math.max(0, top), behavior: "instant" });
        });
      } else if (requestedIntent === "page" || (state?.salesListVisited !== currentUrl() && window.location.hash === `#${listId}`)) {
        element.scrollIntoView({ block: "start", behavior: "instant" });
      }
      window.history.replaceState({ ...window.history.state, salesListVisited: currentUrl() }, "");
    });
    return () => cancelAnimationFrame(frame);
  }, [enabled, ready, selected, request, listId]);

  function update(next: SalesOverviewFilters) {
    const params = new URLSearchParams(window.location.search);
    writeSalesOverviewFilters(params, next);
    replaceSalesListUrl(`/?${params}${window.location.hash}`);
  }
  function open(href: string) {
    const position = listPosition();
    const returnTo = new URLSearchParams(window.location.search).has("salesUnitId") && window.history.state?.salesOverviewReturn ||
      { url: currentUrl(), ...position };
    window.history.replaceState({ ...window.history.state, salesScroll: position.scroll, salesScrollContainers: position.containers }, "");
    window.history.pushState({ salesOverviewReturn: returnTo }, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function back() {
    const saved = window.history.state?.salesOverviewReturn;
    // Only accept a local Sales URL from this history entry, never a redirect.
    if (!saved || typeof saved.url !== "string" || !saved.url.startsWith("/?") || new URLSearchParams(saved.url.split("#")[0].slice(2)).get("screen") !== "sales") return false;
    window.history.pushState({ salesScroll: saved.scroll, salesScrollContainers: saved.containers }, "", saved.url);
    window.dispatchEvent(new PopStateEvent("popstate"));
    return true;
  }
  return { filters, update, open, back, search: location.split("#")[0], location };
}
