"use client";

import { useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";

const NEAR_TOP = 24;
const HIDE_DISTANCE = 48;
const REVEAL_DISTANCE = 12;

/** One controller for the document scroller used by every signed-in portal page.
 * Scroll samples stay outside React; only opening the menu renders the shell.
 */
export function useMobileToolbars(enabled: boolean) {
  const headerRef = useRef<HTMLElement>(null);
  const compactRef = useRef<HTMLDivElement>(null);
  const bottomNavRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDialogElement>(null);
  const originRef = useRef<HTMLElement | null>(null);
  const paused = useRef(false);
  const controller = useRef({ reveal: () => {}, resume: () => {} });
  const [moreOpen, setMoreOpen] = useState(false);

  // Refresh or session expiry can replace the signed-in shell while a menu is
  // open. Close it with that render so a removed dialog cannot leave a body lock.
  if (!enabled && moreOpen) setMoreOpen(false);

  function openMenu(event: MouseEvent<HTMLButtonElement>) {
    originRef.current = event.currentTarget;
    paused.current = true;
    // Restore this control ourselves after unlocking the page. Otherwise the
    // dialog's native restoration can scroll the still-fixed underlying body.
    event.currentTarget.blur();
    setMoreOpen(true);
  }

  function closeMenu() {
    setMoreOpen(false);
  }

  function focusControl(event: PointerEvent<HTMLButtonElement>) {
    // Document scroll-padding protects page fields, but native pointer focus can
    // try to scroll a sticky toolbar button out from under that same padding.
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
  }

  useLayoutEffect(() => {
    if (!enabled) return;
    const header = headerRef.current!;
    const compactBrand = compactRef.current!;
    const nav = bottomNavRef.current;
    const root = document.documentElement;
    const scroller = document.scrollingElement ?? root;
    const mobile = matchMedia("(max-width: 767px)");
    let compact = false;
    let hidden = false;
    let fullHeight = 0;
    let compactHeight = 60;
    let navHeight = 0;
    let maxScroll = 0;
    let lastY = 0;
    let travel = 0;
    let frame = 0;
    let settlingUntil = 0;
    let restoring = false;
    const viewport = window.visualViewport;
    const readY = () => Math.max(0, Math.min(scroller.scrollTop, maxScroll));
    const editing = () => document.activeElement?.matches("input, textarea, select, [contenteditable='true']") ?? false;

    function offsets() {
      root.style.setProperty("--portal-mobile-header", `${mobile.matches ? compact ? compactHeight : fullHeight : 0}px`);
      root.style.setProperty("--portal-mobile-bottom", `${mobile.matches && !hidden ? navHeight : 0}px`);
    }

    function showNav(hide: boolean) {
      hide = mobile.matches && hide && !nav?.contains(document.activeElement);
      if (hidden === hide) return;
      hidden = hide;
      if (nav) {
        nav.dataset.hidden = String(hide);
        nav.inert = hide;
        if (hide) nav.setAttribute("aria-hidden", "true");
        else nav.removeAttribute("aria-hidden");
      }
      offsets();
    }

    function collapse(value: boolean) {
      value = mobile.matches && value;
      if (compact === value) return;
      compact = value;
      header.dataset.compact = String(value);
      offsets();
    }

    // Observe size changes, never measure layout in the scroll listener. The full
    // header keeps its natural document position; its excess scrolls ABOVE the
    // viewport using a negative sticky top, without a placeholder or scrollBy.
    function measure() {
      compactHeight = compactBrand.getBoundingClientRect().height;
      header.style.setProperty("--mobile-compact-height", `${compactHeight}px`);
      fullHeight = header.getBoundingClientRect().height;
      navHeight = nav ? nav.offsetHeight + parseFloat(getComputedStyle(nav).bottom || "0") + 12 : 0;
      maxScroll = Math.max(0, scroller.scrollHeight - root.clientHeight);
      header.style.setProperty("--mobile-header-slide", `${Math.max(0, fullHeight - compactHeight - 1)}px`);
      root.style.setProperty("--portal-mobile-nav-space", `${navHeight}px`);
      offsets();
    }

    function reset() {
      lastY = readY();
      travel = 0;
    }

    function sample() {
      frame = 0;
      const y = readY();
      const delta = y - lastY;
      lastY = y;
      if (!mobile.matches || paused.current || editing() || performance.now() < settlingUntil) {
        travel = 0;
        return;
      }
      if (restoring) {
        restoring = false;
        collapse(y > NEAR_TOP);
        showNav(y > NEAR_TOP);
        travel = 0;
        return;
      }
      if (y <= NEAR_TOP) {
        collapse(false);
        showNav(false);
        travel = 0;
        return;
      }
      if (y > Math.max(128, fullHeight + 24)) collapse(true);
      if (Math.abs(delta) < 1) return;
      // Accumulate deliberate travel in one direction; clamp rubber-band scroll
      // to the document bounds so a bottom bounce cannot reveal the bar.
      travel = Math.sign(delta) === Math.sign(travel) ? travel + delta : delta;
      if (travel <= -REVEAL_DISTANCE) showNav(false);
      else if (compact && travel >= HIDE_DISTANCE) showNav(true);
    }

    function onScroll() {
      if (!frame) frame = requestAnimationFrame(sample);
    }

    function onResize() {
      // Browser chrome, rotation, zoom and keyboard changes are geometry changes,
      // not scroll intent. Hold the current state and start a fresh baseline.
      settlingUntil = performance.now() + 250;
      measure();
      reset();
      if (!mobile.matches) { collapse(false); showNav(false); }
    }

    function restore() {
      measure();
      reset();
      restoring = true;
      settlingUntil = 0;
      onScroll();
    }

    function onFocus(event: FocusEvent) {
      if (paused.current) return;
      if (nav?.contains(event.target as Node)) showNav(false);
      if (editing()) {
        settlingUntil = performance.now() + 250;
        reset();
      }
    }

    const sizes = new ResizeObserver(() => { measure(); reset(); });
    sizes.observe(header);
    sizes.observe(compactBrand);
    if (nav) sizes.observe(nav);
    sizes.observe(document.body);
    root.dataset.portalToolbars = "true";
    measure();
    reset();
    collapse(lastY > NEAR_TOP);
    showNav(lastY > NEAR_TOP);
    controller.current = {
      reveal: () => showNav(false),
      resume: () => { measure(); reset(); settlingUntil = performance.now() + 100; },
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    viewport?.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("pageshow", restore);
    window.addEventListener("popstate", restore);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onResize);
    mobile.addEventListener("change", onResize);
    return () => {
      controller.current = { reveal: () => {}, resume: () => {} };
      cancelAnimationFrame(frame);
      sizes.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      viewport?.removeEventListener("resize", onResize);
      window.removeEventListener("pageshow", restore);
      window.removeEventListener("popstate", restore);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onResize);
      mobile.removeEventListener("change", onResize);
      delete root.dataset.portalToolbars;
      for (const name of ["--portal-mobile-header", "--portal-mobile-bottom", "--portal-mobile-nav-space"]) root.style.removeProperty(name);
      delete header.dataset.compact;
      header.style.removeProperty("--mobile-header-slide");
      header.style.removeProperty("--mobile-compact-height");
      if (nav) { nav.inert = false; nav.removeAttribute("aria-hidden"); delete nav.dataset.hidden; }
    };
  }, [enabled]);

  useLayoutEffect(() => {
    if (!enabled || !moreOpen) return;
    const dialog = menuRef.current!;
    const nav = bottomNavRef.current;
    const origin = originRef.current;
    const body = document.body;
    const { scrollX: x, scrollY: y } = window;
    const previous = { position: body.style.position, top: body.style.top, left: body.style.left, right: body.style.right };
    paused.current = true;
    body.style.position = "fixed";
    body.style.top = `-${y}px`;
    body.style.left = "0";
    body.style.right = "0";
    // Native modal semantics provide focus containment, background inertness and
    // Escape dismissal, while retaining the existing panel and backdrop design.
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[aria-label='Close menu']")?.focus({ preventScroll: true });
    function trapTab(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const controls = [...dialog.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled), input:not(:disabled), a[href], [tabindex='0']")]
        .filter(element => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus({ preventScroll: true });
      }
    }
    dialog.addEventListener("keydown", trapTab);
    return () => {
      dialog.removeEventListener("keydown", trapTab);
      if (nav?.contains(origin)) controller.current.reveal();
      dialog.close();
      Object.assign(body.style, previous);
      window.scrollTo({ left: x, top: y, behavior: "instant" });
      origin?.focus({ preventScroll: true });
      controller.current.resume();
      paused.current = false;
    };
  }, [enabled, moreOpen]);

  return { headerRef, compactRef, bottomNavRef, menuRef, moreOpen, openMenu, closeMenu, focusControl };
}
