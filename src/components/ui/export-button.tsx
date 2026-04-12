"use client";

import { Download } from "lucide-react";

interface ExportButtonProps {
  href: string;
  label?: string;
}

export function ExportButton({ href, label = "Export CSV" }: ExportButtonProps) {
  return (
    <a
      href={href}
      download
      className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors"
    >
      <Download className="h-4 w-4" />
      {label}
    </a>
  );
}
