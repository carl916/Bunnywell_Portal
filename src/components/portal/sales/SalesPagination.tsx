"use client";

import { useState } from "react";

export const SALES_PAGE_SIZE = 12;

export function useSalesPagination(total: number, resetKey: string) {
  const [selection, setSelection] = useState({ key: resetKey, page: 1 });
  const pageCount = Math.max(1, Math.ceil(total / SALES_PAGE_SIZE));
  const currentPage = selection.key === resetKey ? Math.min(selection.page, pageCount) : 1;
  // Keep the stored page valid too, so refreshed data cannot resurrect an old page.
  if (selection.key !== resetKey || selection.page !== currentPage) {
    setSelection({ key: resetKey, page: currentPage });
  }
  return { currentPage, setPage: (page: number) => setSelection({ key: resetKey, page: Math.max(1, Math.min(pageCount, page)) }) };
}

export function SalesPagination({ total, currentPage, onPageChange }: {
  total: number; currentPage: number; onPageChange: (page: number) => void;
}) {
  return <nav aria-label="Results pagination" className="mt-4 flex flex-col gap-3 text-sm text-[#617169] sm:flex-row sm:items-center sm:justify-between">
    <span aria-live="polite">Showing {total === 0 ? 0 : (currentPage - 1) * SALES_PAGE_SIZE + 1}–{Math.min(currentPage * SALES_PAGE_SIZE, total)} of {total}</span>
    <div className="flex justify-end gap-2">
      <button className="secondary" type="button" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage <= 1}>Previous</button>
      <button className="secondary" type="button" onClick={() => onPageChange(currentPage + 1)} disabled={currentPage >= Math.max(1, Math.ceil(total / SALES_PAGE_SIZE))}>Next</button>
    </div>
  </nav>;
}
