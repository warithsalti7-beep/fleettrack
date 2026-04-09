import { Topbar } from "@/components/layout/topbar";
import { getCurrency } from "@/lib/currency-server";
import { AnalyticsClient } from "./analytics-client";

export default async function AnalyticsPage() {
  const currency = await getCurrency();

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Topbar title="Analytics & Reports" subtitle="Business intelligence for your fleet" />
      <AnalyticsClient currency={currency} />
    </div>
  );
}
