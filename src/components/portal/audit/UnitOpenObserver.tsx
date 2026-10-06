"use client";
import { useEffect, useRef } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { consumeUnitOpenIntent } from "@/lib/audit/unit-open";

// Mounted only with displayed unit content. Observer waits for an actual
// visible paint, and never arms intent during hydration, refresh or prefetch.
export function UnitOpenObserver({ unitId }: { unitId: string }) {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!marker.current) return;
    let frame = 0;
    let visible = false;
    const record = () => {
      if (!visible || document.visibilityState !== "visible") return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (document.visibilityState !== "visible" || !consumeUnitOpenIntent(unitId)) return;
        void createSupabaseBrowserClient().rpc("record_unit_open", { p_unit: unitId }).then(() => {}, () => {});
      });
    };
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(e => e.isIntersecting);
      record();
    });
    observer.observe(marker.current);
    document.addEventListener("visibilitychange", record);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); document.removeEventListener("visibilitychange", record); };
  }, [unitId]);
  return <span ref={marker} aria-hidden="true" className="block h-px w-px" />;
}
