"use client";

import type { KeyboardEvent } from "react";

const VIEWS = [
  { key: "deposits", label: "Deposits", panelId: "sale-deposits" },
  { key: "agent_fees", label: "Agent fees", panelId: "agent-fees" },
] as const;

export function FinancialsTabs({ activeView, onChange }: {
  activeView: "deposits" | "agent_fees";
  onChange: (view: "deposits" | "agent_fees") => void;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % VIEWS.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + VIEWS.length) % VIEWS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = VIEWS.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    onChange(VIEWS[nextIndex].key);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      .item(nextIndex)
      .focus({ preventScroll: true });
  }

  return (
    <div role="tablist" aria-label="Financials view" aria-orientation="horizontal" className="flex gap-6 border-b border-[#d9ded6]">
      {VIEWS.map((view, index) => {
        const active = activeView === view.key;
        return (
          <button
            key={view.key}
            id={`financials-${view.key}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={view.panelId}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(view.key)}
            onKeyDown={event => handleKeyDown(event, index)}
            className={`-mb-px min-h-11 shrink-0 border-b-2 bg-transparent py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D6A23A] ${active ? "border-[#0F3D2E] text-[#0F3D2E]" : "border-transparent text-[#52645b] hover:border-[#a8b5ac] hover:text-[#0F3D2E]"}`}
          >
            <span className={`text-sm ${active ? "font-semibold" : "font-medium"}`}>{view.label}</span>
          </button>
        );
      })}
    </div>
  );
}
