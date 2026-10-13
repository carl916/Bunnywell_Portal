"use client";
import { useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { WorkItem } from "@/lib/dashboard/types";
import { saleRecordUrl } from "@/lib/sales/developer-overview";
import styles from "./SaleReviewNavigation.module.css";

const workspaces: Record<string, string> = { progression: "Progression", financials: "Financials", commercial: "Commercial" };

/** Matching actions live in the record workspace, not an expanded table row. */
export function SaleReviewNavigation({actions,search,disabled,onOpen}:{actions:WorkItem[];search:string;disabled:boolean;onOpen:(href:string)=>void}) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  if(actions.length === 0)return null;
  return <nav className={styles.summary} id="sales-matching-actions" aria-label="Matching actions">
    <h4 className={styles.heading}>Actions requiring attention <span>({actions.length})</span></h4>
    <ul id={listId} className={styles.list}>{(expanded ? actions : actions.slice(0, 3)).map(item=>{
      const href=item.destination?saleRecordUrl(item.destination,search):null;
      const workspace = item.destination?.section ? workspaces[item.destination.section] : undefined;
      const content = <><span className={styles.text}><span>{item.action}</span>{workspace && <small>{workspace}</small>}</span><ChevronRight size={16} aria-hidden="true" /></>;
      return <li key={item.id}>{!href||disabled?<span className={styles.row} aria-disabled="true">{content}</span>:<a className={styles.row} href={href} aria-label={item.action} onClick={event=>{
        if(event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
        event.preventDefault();onOpen(href);
      }}>{content}</a>}</li>;
    })}</ul>
    {actions.length > 3 && <button type="button" className={styles.toggle} aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(value => !value)}>{expanded ? "Show fewer" : "Show all"}</button>}
  </nav>;
}
