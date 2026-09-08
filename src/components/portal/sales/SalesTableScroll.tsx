"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoveHorizontal } from "lucide-react";
import styles from "./SalesTableScroll.module.css";

export function SalesTableScroll({ children, label, className = "" }: { children: ReactNode; label: string; className?: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const measure = () => setOverflow(node.scrollWidth > node.clientWidth + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    measure();
    return () => observer.disconnect();
  }, []);

  return <div className={`${styles.container} ${className}`} data-sales-table>
    <span className={styles.hint} data-visible={overflow && !scrolled} aria-hidden="true"><MoveHorizontal size={14} /> Swipe</span>
    <div ref={viewport} className={styles.viewport} role="region" aria-label={label} tabIndex={overflow ? 0 : undefined}
      onScroll={() => { if (viewport.current && viewport.current.scrollLeft > 4) setScrolled(true); }}>
      {children}
    </div>
  </div>;
}
