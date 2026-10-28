"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { UnreadBadge } from "./SaleConversation";
import styles from "./SaleFileHeader.module.css";

/** One identity row for the entire sale file. Its measured height also protects
 * anchors and focused fields when text wraps or the viewport changes. */
export function SaleFileHeader({ unitNumber, buildingName, status, conversationOpen, unread, onOpenConversation }: {
  unitNumber: string; buildingName: string; status: ReactNode;
  conversationOpen: boolean; unread: number; onOpenConversation: () => void;
}) {
  const header = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = header.current!;
    const root = document.documentElement;
    const previous = root.style.getPropertyValue("--sale-file-header-height");
    const measure = () => root.style.setProperty("--sale-file-header-height", `${element.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (previous) root.style.setProperty("--sale-file-header-height", previous);
      else root.style.removeProperty("--sale-file-header-height");
    };
  }, []);

  return <header ref={header} className={styles.header} data-sale-file-header aria-label="Sale file identity">
    <div className={styles.identity}><h3>Unit {unitNumber}</h3><p>{buildingName}</p></div>
    <div className={styles.status}>{status}</div>
    <button type="button" className={`secondary ${styles.comments}`} aria-haspopup="dialog"
      aria-controls="sale-conversation" aria-expanded={conversationOpen}
      onPointerDown={event => { event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); }}
      onClick={onOpenConversation}>Comments &amp; activity <UnreadBadge count={unread} /></button>
  </header>;
}
