"use client";
import type { WorkItem } from "@/lib/dashboard/types";
import { saleRecordUrl } from "@/lib/sales/developer-overview";

/** Matching actions live in the record workspace, not an expanded table row. */
export function SaleReviewNavigation({actions,search,disabled,onOpen}:{actions:WorkItem[];search:string;disabled:boolean;onOpen:(href:string)=>void}) {
  if(actions.length<2)return null;
  return <nav className="panel" id="sales-matching-actions" aria-label="Matching actions">
    <h3 className="font-bold text-[#0F3D2E]">{actions.length} matching actions in this sale</h3>
    <p className="mt-1 text-sm text-[#617169]">Open each section below to review its current position.</p>
    <ul className="mt-3 flex flex-wrap gap-2">{actions.map(item=>{
      const href=item.destination?saleRecordUrl(item.destination,search):null;
      return <li key={item.id}>{!href||disabled?<span>{item.action}</span>:<a className="secondary inline-block" href={href} onClick={event=>{
        if(event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
        event.preventDefault();onOpen(href);
      }}>{item.action}</a>}</li>;
    })}</ul>
  </nav>;
}
