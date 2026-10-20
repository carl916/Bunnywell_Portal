import { emailMoney } from "@/lib/sales/legal-email";

export function DepositBeforeExchange({ percent, amount, timing, note }: {
  percent?: number | null;
  amount?: number | null;
  timing: string;
  note?: string;
}) {
  return <div className="mt-2 text-sm text-[#617169]">
    <p>Expected{percent != null ? ` (${percent}%)` : ""}: {emailMoney(amount)}. {timing}</p>
    {note && <p className="mt-1">{note}</p>}
    <p className="mt-1">Receipt recording becomes available after legal exchange.</p>
  </div>;
}
