"use client";

import { useRef } from "react";
import { formatGbp, formatGbpInputValue, rawGbpInputValue } from "@/lib/sales/currency";

type GbpInputProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
};

function caretFromDigitCount(value: string, digitCount: number) {
  if (digitCount <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (/\d/.test(value[index])) seen += 1;
    if (seen >= digitCount) return index + 1;
  }
  return value.length;
}

export function GbpInput({ value, onChange, disabled, placeholder, className = "", "aria-label": ariaLabel }: GbpInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const displayValue = formatGbpInputValue(value);

  return (
    <div className={`gbp-input ${className}`} data-disabled={disabled ? "true" : "false"}>
      <span className="gbp-input-prefix">{"\u00a3"}</span>
      <input
        ref={inputRef}
        aria-label={ariaLabel}
        className="gbp-input-control"
        disabled={disabled}
        inputMode="numeric"
        placeholder={placeholder}
        type="text"
        value={displayValue}
        onChange={(event) => {
          const selectionStart = event.currentTarget.selectionStart ?? event.currentTarget.value.length;
          const digitsBeforeCaret = event.currentTarget.value.slice(0, selectionStart).replace(/[^\d]/g, "").length;
          const nextRawValue = rawGbpInputValue(event.currentTarget.value);
          onChange(nextRawValue);
          window.requestAnimationFrame(() => {
            const input = inputRef.current;
            if (!input) return;
            const nextDisplayValue = formatGbpInputValue(nextRawValue);
            const nextCaret = caretFromDigitCount(nextDisplayValue, digitsBeforeCaret);
            input.setSelectionRange(nextCaret, nextCaret);
          });
        }}
      />
    </div>
  );
}

export function GbpValue({ value, className = "" }: { value: string | number | null | undefined; className?: string }) {
  return <span className={`numeric-value text-right ${className}`}>{formatGbp(value)}</span>;
}
