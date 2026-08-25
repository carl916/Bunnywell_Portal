"use client";

import type { KeyboardEvent } from "react";

export type SaleFileWorkspace = "progression" | "financials" | "commercial";

const SALE_FILE_WORKSPACES: Array<{
  key: SaleFileWorkspace;
  label: string;
  description: string;
  panelId: string;
}> = [
  { key: "progression", label: "Progression", description: "Sale lifecycle", panelId: "unit-sale-progression" },
  { key: "financials", label: "Financials", description: "Invoices & payments", panelId: "agent-fees" },
  { key: "commercial", label: "Commercial", description: "Terms & fees", panelId: "unit-sale-commercial" },
];

export function SaleFileWorkspaceTabs({
  activeWorkspace,
  onChange,
}: {
  activeWorkspace: SaleFileWorkspace;
  onChange: (workspace: SaleFileWorkspace) => void;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % SALE_FILE_WORKSPACES.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + SALE_FILE_WORKSPACES.length) % SALE_FILE_WORKSPACES.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = SALE_FILE_WORKSPACES.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextWorkspace = SALE_FILE_WORKSPACES[nextIndex];
    onChange(nextWorkspace.key);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      .item(nextIndex)
      .focus();
  }

  return (
    <nav className="sale-file-tab-scroll mt-3 overflow-x-auto overflow-y-hidden" aria-label="Sale file workspaces">
      <div
        className="grid min-w-[24rem] grid-cols-3 border-b border-[var(--bw-border-strong)]"
        role="tablist"
        aria-orientation="horizontal"
      >
        {SALE_FILE_WORKSPACES.map((workspace, index) => {
          const isActive = activeWorkspace === workspace.key;

          return (
            <button
              key={workspace.key}
              id={`sale-file-tab-${workspace.key}`}
              className={`-mb-px flex min-h-[3.25rem] min-w-0 flex-col items-center justify-center border border-t-[3px] px-3 py-1.5 text-center transition-colors ${
                isActive
                  ? "rounded-t-md border-x-[var(--bw-border-strong)] border-b-white border-t-[var(--bw-primary)] bg-white text-[var(--bw-primary)]"
                  : "border-transparent bg-transparent text-[#52645b] hover:border-b-[var(--bw-border-strong)] hover:bg-white/60 hover:text-[var(--bw-primary)]"
              } focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--bw-accent)]`}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={workspace.panelId}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onChange(workspace.key)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              <span className="truncate text-sm font-extrabold leading-tight sm:text-base">{workspace.label}</span>
              <span className={`mt-0.5 whitespace-nowrap text-[0.68rem] font-medium leading-tight sm:text-xs ${isActive ? "text-[#52645b]" : "text-[var(--bw-muted)]"}`}>
                {workspace.description}
              </span>
              {isActive && <span className="sr-only">Current workspace</span>}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
