"use client";

import {useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent} from "react";
import {ChevronDown, PanelRight} from "lucide-react";
import type {SaleRow} from "@/lib/experiments/building-contracts/contracts";
import SaleNavigation, {saleSectionIcons} from "./SaleNavigation";
import {label, sections} from "./TaskWorkspace";
import m from "./MobileSaleWorkspace.module.css";

export default function MobileSaleHeader({row, buildingName, section, role, informationOpen, onInformationOpen}: {
  row: SaleRow; buildingName: string; section: string; role: string;
  informationOpen: boolean; onInformationOpen: () => void;
}) {
  const id = useId();
  const header = useRef<HTMLElement>(null), marker = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null), spacer = useRef<HTMLDivElement>(null);
  const expandedHeight = useRef(0);
  const [compact, setCompact] = useState(false), [menuOpen, setMenuOpen] = useState(false);
  const title = sections.find(([key]) => key === section)?.[1] || "Sale pages";
  const Icon = saleSectionIcons[section];

  useEffect(() => {
    // The marker never moves when the header changes height. Reserve the lost
    // height below the sticky header so the workflow and scroll position stay put.
    const observer = new IntersectionObserver(([entry]) => {
      setCompact(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    observer.observe(marker.current!);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const measure = () => {
      const height = header.current!.getBoundingClientRect().height;
      if (!height) return;
      if (!compact) expandedHeight.current = height;
      spacer.current!.style.height = `${compact ? Math.max(0, expandedHeight.current - height) : 0}px`;
      document.documentElement.style.setProperty("--mobile-sale-header-height", `${height}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header.current!);
    return () => observer.disconnect();
  }, [compact]);

  useEffect(() => () => { document.documentElement.style.removeProperty("--mobile-sale-header-height"); }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = () => menu.current?.hidePopover();
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, {passive: true});
    return () => { window.removeEventListener("resize", dismiss); window.removeEventListener("scroll", dismiss); };
  }, [menuOpen]);

  function positionMenu() {
    const bounds = trigger.current!.getBoundingClientRect();
    const viewport = window.visualViewport;
    const bottom = (viewport?.height ?? window.innerHeight) + (viewport?.offsetTop ?? 0);
    Object.assign(menu.current!.style, {
      left: "12px", top: `${bounds.bottom + 6}px`, width: `${document.documentElement.clientWidth - 24}px`,
      maxHeight: `${Math.max(100, bottom - bounds.bottom - 18)}px`,
    });
  }

  function navigateKeys(event: KeyboardEvent<HTMLDivElement>) {
    const links = Array.from(menu.current!.querySelectorAll<HTMLAnchorElement>("a"));
    const index = links.indexOf(document.activeElement as HTMLAnchorElement);
    const next = event.key === "ArrowDown" ? (index + 1) % links.length
      : event.key === "ArrowUp" ? (index - 1 + links.length) % links.length
      : event.key === "Home" ? 0 : event.key === "End" ? links.length - 1 : null;
    if (next !== null) { event.preventDefault(); links[next]?.focus(); }
  }

  return <>
    <div className={m.markerAnchor} aria-hidden="true"><span ref={marker}/></div>
    <header ref={header} className={m.header} aria-label="Sale identity" data-compact={compact}>
      <div className={m.identification}>
        <strong>{buildingName} <span>/</span> {row.unitNumber}</strong>
        <p>{row.buyerLabel}</p>
      </div>
      <span className={m.status} aria-label={`Sale status: ${label(row.stage)}`}>{label(row.stage)}</span>
      <div className={m.controls}>
        <button ref={trigger} type="button" className={m.pageControl} popoverTarget={id}
          aria-label={`Sale page: ${title}`} aria-haspopup="dialog" aria-expanded={menuOpen} aria-controls={id}>
          {Icon && <Icon size={18} aria-hidden="true"/>}<span>{title}</span><ChevronDown size={17} aria-hidden="true"/>
        </button>
        <button type="button" className={m.infoControl} aria-haspopup="dialog" aria-expanded={informationOpen}
          aria-controls="sale-information-dialog" onClick={onInformationOpen}>
          <PanelRight size={18} aria-hidden="true"/><span>Sale info</span>
        </button>
      </div>
      <div ref={menu} id={id} popover="auto" role="dialog" aria-label="Sale navigation" tabIndex={-1}
        className={m.menu} onKeyDown={navigateKeys}
        onBeforeToggle={event => { if (event.newState === "open") positionMenu(); }}
        onToggle={event => {
          const open = event.newState === "open";
          setMenuOpen(open);
          if (open && menu.current) {
            const selected = menu.current.querySelector<HTMLAnchorElement>('a[aria-current="page"]');
            selected?.focus({preventScroll: true});
            if (selected) {
              const item = selected.getBoundingClientRect(), bounds = menu.current.getBoundingClientRect();
              // Scroll only the menu, including when the current page is in the
              // final group on a short viewport. Never move the workflow page.
              if (item.bottom > bounds.bottom - 12) menu.current.scrollTop += item.bottom - bounds.bottom + 12;
              else if (item.top < bounds.top + 12) menu.current.scrollTop -= bounds.top - item.top + 12;
            }
          }
        }}>
        <SaleNavigation row={row} section={section} role={role} className={m.navigation}
          onNavigate={() => menu.current?.hidePopover()}/>
      </div>
    </header>
    <div ref={spacer} className={m.spacer} aria-hidden="true"/>
  </>;
}
