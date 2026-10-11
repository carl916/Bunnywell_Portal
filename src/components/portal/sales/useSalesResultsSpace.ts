"use client";

import { useCallback, useRef } from "react";

/** Keep the list's occupied space through filtering and a sale-file round trip.
 * Owned by the workspace, so unmounting the table cannot lose its return height.
 * A new scope or viewport width starts a new measurement. No scrolling/focus.
 */
export function useSalesResultsSpace(scope: string) {
  const measurement = useRef({ scope, width: 0, height: 0 });
  return useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const content = element.firstElementChild;
    if (!content) return;
    // A hard reload in a sale file loses refs. Its saved list history restores
    // only geometry for this exact authorised scope and width, never sale data.
    const saved = window.history.state?.salesResultsSpace;
    if (saved?.scope === scope && Number.isFinite(saved.width) && Number.isFinite(saved.height) && saved.height > 0) {
      measurement.current = saved;
    }
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      const previous = measurement.current;
      const height = Math.ceil(content.getBoundingClientRect().height);
      measurement.current = { scope, width, height: previous.scope === scope && previous.width === width ? Math.max(previous.height, height) : height };
      element.style.minHeight = `${measurement.current.height}px`;
      element.dataset.salesResultsSpace = JSON.stringify(measurement.current);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [scope]);
}
