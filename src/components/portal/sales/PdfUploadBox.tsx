"use client";
import { FileCheck2, FileText, UploadCloud, X } from "lucide-react";
export type UploadVersion = { file_name: string; uploaded_at: string; file_size_bytes: number | null };
const formatDate = (date: string) => new Date(date).toLocaleDateString("en-GB");
const fileSizeLabel = (size: number | null) => size == null ? "" : size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;

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
  emptyPrompt,
  helperText = "PDF only, maximum 10 MB",
  onFiles,
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
  emptyPrompt?: string;
  helperText?: string;
  onFiles?: (files: File[]) => void;
}) {
  if (file) {
    return <div className="min-w-0 rounded-bw-card border border-[#9bb5a6] bg-[#EEF6F1] p-5" aria-live="polite">
      <div className="flex min-w-0 items-start gap-3">
        <FileCheck2 className="mt-1 shrink-0 text-[#0F3D2E]" size={24} aria-hidden />
        <div className="min-w-0"><p className="font-bold text-[#0F3D2E] [overflow-wrap:anywhere]">{file.name}</p><p className="mt-1 text-sm text-[#617169]">{fileSizeLabel(file.size)}</p><p className="mt-2 text-sm font-semibold text-[#0F3D2E]">Selected – ready to submit</p></div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <label className={`secondary upload-target inline-flex items-center ${disabled ? "opacity-60" : "cursor-pointer"}`}>
          Replace<input id={id} aria-label={label} className="sr-only" type="file" accept="application/pdf,.pdf" disabled={disabled} onChange={(event) => { onFile(event.target.files?.[0] ?? null); event.target.value = ""; }} />
        </label>
        <button type="button" className="secondary" disabled={disabled} onClick={onClear}>Remove</button>
      </div>
    </div>;
  }

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
              <input className="sr-only" aria-label={`Replace ${label}`} type="file" accept="application/pdf" onChange={(event) => { onFile(event.target.files?.[0] ?? null); event.target.value = ""; }} />
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
        if (onFiles) onFiles(Array.from(event.dataTransfer.files));
        else onFile(event.dataTransfer.files?.[0] ?? null);
      }}
    >
      <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[#EEF6F1] text-[#0F3D2E]">
        <UploadCloud size={20} aria-hidden />
      </span>
      <span className="mt-3 block font-bold text-[#0F3D2E]">{emptyPrompt ?? label}</span>
      <span className="mt-1 block text-sm text-[#617169]">{emptyPrompt ? helperText : `Choose a file or drag and drop. ${helperText}.`}</span>
      <input
        id={id}
        aria-label={label}
        className="sr-only"
        type="file"
        accept="application/pdf"
        multiple={Boolean(onFiles)}
        disabled={disabled}
        onChange={(event) => { if (onFiles) onFiles(Array.from(event.target.files ?? [])); else onFile(event.target.files?.[0] ?? null); event.target.value = ""; }}
      />
    </label>
  );
}

