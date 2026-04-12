"use client";

import { useRouter, usePathname } from "next/navigation";
import { ChevronLeft } from "lucide-react";

export function BackButton() {
  const router = useRouter();
  const pathname = usePathname();

  if (pathname === "/dashboard") return null;

  return (
    <button
      onClick={() => router.back()}
      className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
      title="Go back"
    >
      <ChevronLeft className="h-4 w-4" />
      Back
    </button>
  );
}
