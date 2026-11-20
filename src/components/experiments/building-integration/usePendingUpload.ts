"use client";
import { useEffect } from "react";

// Files stay in their owning slot's memory. Only a count is shared to present
// one navigation warning when several slots have unfinished uploads.
const pending = new Set<symbol>();
const warning = "You have selected PDFs that have not been uploaded. Leave this screen and discard them?";
let retainedUrl = "";
function beforeLeave(event: Event) {
  if (pending.size && !window.confirm(warning)) event.preventDefault();
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (pending.size) { event.preventDefault(); event.returnValue = ""; }
}
function backOrForward(event: PopStateEvent) {
  if (!event.isTrusted || !pending.size || location.href === retainedUrl) return;
  if (!window.confirm(warning)) {
    history.pushState(null, "", retainedUrl);
    event.stopImmediatePropagation();
  }
}
export function usePendingUpload(selected: boolean) {
  useEffect(() => {
    if (!selected) return;
    const slot = Symbol();
    if (!pending.size) {
      retainedUrl = location.href;
      window.addEventListener("workspace-before-leave", beforeLeave);
      window.addEventListener("beforeunload", beforeUnload);
      window.addEventListener("popstate", backOrForward, true);
    }
    pending.add(slot);
    return () => {
      pending.delete(slot);
      if (!pending.size) {
        window.removeEventListener("workspace-before-leave", beforeLeave);
        window.removeEventListener("beforeunload", beforeUnload);
        window.removeEventListener("popstate", backOrForward, true);
      }
    };
  }, [selected]);
}
