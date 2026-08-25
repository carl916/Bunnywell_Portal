"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

export type ActivePanelRequest = {
  focus?: HTMLElement | null | (() => HTMLElement | null);
};

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function resolvedFocusTarget(target: ActivePanelRequest["focus"]) {
  return typeof target === "function" ? target() : target;
}

function isSuitablyPositioned(panel: HTMLElement) {
  const bounds = panel.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const scrollMarginTop = Number.parseFloat(window.getComputedStyle(panel).scrollMarginTop) || 0;
  const expectedTop = Math.max(16, scrollMarginTop);
  const visibleHeight = Math.min(bounds.bottom, viewportHeight - 16) - Math.max(bounds.top, expectedTop);
  const usefulHeight = Math.min(160, bounds.height);

  return bounds.top >= expectedTop - 12
    && bounds.top <= Math.min(viewportHeight * 0.45, expectedTop + 180)
    && visibleHeight >= usefulHeight;
}

/**
 * Coordinates viewport movement with React's committed render. Call requestActivePanel
 * in the same event/update that reveals or resets the target panel.
 */
export function useActivePanel<T extends HTMLElement>() {
  const panelRef = useRef<T | null>(null);
  const pendingRequestRef = useRef<ActivePanelRequest | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  const requestActivePanel = useCallback((request: ActivePanelRequest = {}) => {
    pendingRequestRef.current = request;
    setRequestVersion((version) => version + 1);
  }, []);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const request = pendingRequestRef.current;
    if (!panel || !request) return;

    pendingRequestRef.current = null;
    if (!isSuitablyPositioned(panel)) {
      panel.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "start",
      });
    }

    const focusTarget = resolvedFocusTarget(request.focus);
    if (focusTarget && !(focusTarget instanceof HTMLInputElement && focusTarget.disabled)) {
      focusTarget.focus({ preventScroll: true });
    }
  }, [requestVersion]);

  return { panelRef, requestActivePanel };
}
