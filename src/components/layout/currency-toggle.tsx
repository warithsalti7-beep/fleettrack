"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCurrencyAction } from "@/app/actions";
import type { Currency } from "@/lib/currency";

export function CurrencyToggle({ current }: { current: Currency }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const next: Currency = current === "NOK" ? "EUR" : "NOK";

  return (
    <button
      onClick={() =>
        startTransition(async () => {
          await setCurrencyAction(next);
          router.refresh();
        })
      }
      disabled={pending}
      title={`Switch to ${next}`}
      className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50"
    >
      <span className="text-xs text-gray-400">{current === "NOK" ? "kr" : "€"}</span>
      {current}
      <span className="text-gray-300">⇄</span>
      {next}
    </button>
  );
}
