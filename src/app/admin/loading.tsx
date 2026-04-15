/**
 * Fallback shown by Next.js while an /admin/* page is fetching its
 * data on the server. Keeps the header area stable; the rest shimmers
 * so the user sees "something is loading" rather than a blank screen.
 */
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <header className="mb-6">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-64 mt-2" />
      </header>

      {/* Toolbar-shaped placeholder */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Skeleton className="h-9 flex-1 min-w-[220px]" />
        <Skeleton className="h-9 w-[180px]" />
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="h-9 w-32" />
        </div>
      </div>

      {/* Body placeholder: 6 cards on large screens, rows on small. */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[120px] w-full" />
        ))}
      </div>

      <div className="mt-6 rounded-lg border border-border-muted bg-surface-1 p-4 space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </>
  );
}
