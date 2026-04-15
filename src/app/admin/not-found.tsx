import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function AdminNotFound() {
  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold tracking-tight">Page not found</h1>
      <p className="mt-2 text-sm text-muted">
        The page you were looking for is not part of the admin area.
      </p>
      <Link href="/admin/overview" className="inline-block mt-4">
        <Button>Go to Overview</Button>
      </Link>
    </div>
  );
}
