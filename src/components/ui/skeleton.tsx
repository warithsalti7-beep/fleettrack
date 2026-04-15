import { cn } from "@/lib/utils";

/**
 * Skeleton — animated placeholder block for loading states.
 * Token-based so the shimmer adapts to dark / light mode.
 */
export function Skeleton({
  className,
  rounded = "md",
}: {
  className?: string;
  rounded?: "sm" | "md" | "lg" | "full";
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "bg-surface-3 relative overflow-hidden",
        rounded === "sm"   && "rounded-sm",
        rounded === "md"   && "rounded-md",
        rounded === "lg"   && "rounded-lg",
        rounded === "full" && "rounded-full",
        className,
      )}
      style={{
        backgroundImage:
          "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%)",
        backgroundSize: "200% 100%",
        animation: "ft-shimmer 1.4s linear infinite",
      }}
    />
  );
}

/** N full-width skeleton rows at a fixed height — ideal for list placeholders. */
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="w-full h-9" />
      ))}
    </div>
  );
}
