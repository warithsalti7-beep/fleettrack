"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronUp, SlidersHorizontal, X } from "lucide-react";

interface SortOption {
  value: string;
  label: string;
}

interface SortBarProps {
  options: SortOption[];
  currentSort?: string;
  currentDir?: string;
}

export function SortBar({ options, currentSort = "", currentDir = "asc" }: SortBarProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeOption = options.find((o) => o.value === currentSort);

  function applySort(sort: string, dir: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (sort) {
      params.set("sort", sort);
      params.set("dir", dir);
    } else {
      params.delete("sort");
      params.delete("dir");
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  function clearSort() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("sort");
    params.delete("dir");
    router.push(`${pathname}?${params.toString()}`);
    setOpen(false);
  }

  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors"
      >
        <SlidersHorizontal className="h-4 w-4 text-gray-500" />
        Sort & Filter
        {activeOption && (
          <span className="ml-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
            {activeOption.label} {currentDir === "asc" ? "↑" : "↓"}
          </span>
        )}
        {open ? (
          <ChevronUp className="h-4 w-4 text-gray-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-gray-400" />
        )}
      </button>

      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
          <span className="text-xs font-medium text-gray-500 mr-1">Sort by:</span>
          {options.map((option) => {
            const isActive = currentSort === option.value;
            return (
              <div key={option.value} className="flex items-center gap-1">
                <button
                  onClick={() => applySort(option.value, isActive && currentDir === "asc" ? "desc" : "asc")}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {option.label}
                  {isActive && (
                    <span className="ml-1">{currentDir === "asc" ? "↑" : "↓"}</span>
                  )}
                </button>
              </div>
            );
          })}
          {currentSort && (
            <button
              onClick={clearSort}
              className="ml-auto flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
