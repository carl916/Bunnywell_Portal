"use client";
import { FileText, UploadCloud, X } from "lucide-react";
export type UploadVersion = { file_name: string; uploaded_at: string; file_size_bytes: number | null };
const formatDate = (date: string) => new Date(date).toLocaleDateString("en-GB");
const fileSizeLabel = (size: number | null) => size ? (size / 1024 / 1024).toFixed(1) + " MB" : "";

export function PdfUploadBox({
  id,
  label,
  file,
  currentVersion,
  disabled,
  onOpen,
  onFile,
  onClear,
  onRemoveCurrent,
}: {
  id: string;
  label: string;
  file: File | null;
  currentVersion?: UploadVersion | null;
  disabled?: boolean;
  onOpen?: () => void;
  onFile: (file: File | null) => void;
  onClear: () => void;
  onRemoveCurrent?: () => void;
}) {
  const selectedName = file?.name ?? null;

  if (currentVersion && !file) {
    return (
      <div className="min-w-0 py-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 max-w-full items-start gap-3">
            <span className="mt-1 shrink-0 rounded-full bg-[#EEF6F1] p-2 text-[#0F3D2E]"><FileText size={18} aria-hidden /></span>
            <div className="min-w-0">
              <p className="font-bold text-[#0F3D2E] [overflow-wrap:anywhere]">{currentVersion.file_name}</p>
              <p className="text-sm text-[#617169]">
                Uploaded {formatDate(currentVersion.uploaded_at)} {fileSizeLabel(currentVersion.file_size_bytes)}
              </p>
            </div>
          </div>
          <button className="secondary min-h-9 px-3 py-1.5 text-sm" type="button" onClick={onOpen} disabled={!onOpen}>
            View/download
          </button>
        </div>
        {!disabled && (
          onRemoveCurrent ? (
            <button className="secondary mt-3 min-h-9 w-fit px-3 py-1.5 text-sm" type="button" onClick={onRemoveCurrent}>
              <X size={14} aria-hidden /> Remove PDF
            </button>
          ) : (
            <label className="secondary upload-target mt-3 inline-flex w-fit cursor-pointer items-center gap-2">
              Replace PDF
              <input className="sr-only" type="file" accept="application/pdf" onChange={(event) => onFile(event.target.files?.[0] ?? null)} />
            </label>
          )
        )}
      </div>
    );
  }

  return (
    <label
      className={`upload-target block rounded-bw-card border border-dashed p-5 text-center transition ${disabled ? "cursor-not-allowed border-[#d9ded6] bg-[#f4f6f3] opacity-70" : "cursor-pointer border-[#cdbd9d] bg-white hover:border-[#0F3D2E]"}`}
      htmlFor={id}
      onDragOver={(event) => {
        if (disabled) return;
        event.preventDefault();
      }}
      onDrop={(event) => {
        if (disabled) return;
        event.preventDefault();
        onFile(event.dataTransfer.files?.[0] ?? null);
      }}
    >
      <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[#EEF6F1] text-[#0F3D2E]">
        <UploadCloud size={20} aria-hidden />
      </span>
      <span className="mt-3 block font-bold text-[#0F3D2E]">{label}</span>
      <span className="mt-1 block text-sm text-[#617169]">Choose a file or drag and drop. PDF only, maximum 10 MB.</span>
      {selectedName && (
        <span className="mt-3 inline-flex max-w-full items-center gap-2 rounded-bw-inset border border-[#d9ded6] bg-[#F7F5EF] px-3 py-1 text-sm font-semibold text-[#0F3D2E]">
          <span className="min-w-0 [overflow-wrap:anywhere]">{selectedName}</span>
          <button
            type="button"
            className="rounded-full p-0.5 text-[#617169] hover:bg-white"
            onClick={(event) => {
              event.preventDefault();
              onClear();
            }}
            aria-label="Remove selected PDF"
          >
            <X size={14} aria-hidden />
          </button>
        </span>
      )}
      <input
        id={id}
        className="sr-only"
        type="file"
        accept="application/pdf"
        disabled={disabled}
        onChange={(event) => onFile(event.target.files?.[0] ?? null)}
      />
    </label>
  );
}

