/**
 * Live KPI grid — pure server-rendered presentation component.
 *
 * Uses the shared Card primitive so dark/light theme, spacing, and
 * shadows all come from the design tokens. Responsive: 2 columns on
 * mobile, 3 on tablet, 6 on large screens.
 */
import { Card, CardTitle, CardValue, CardSub } from "@/components/ui/card";
import { formatNok, formatPercent } from "@/lib/format";

export type Kpis = {
  revenueToday: number;
  netRevenue: number;
  netProfit: number;
  marginPct: number;
  breakEven: number;
  tripsToday: number;
  avgTripFare: number;
  driversTotal: number;
  driversActive: number;
  vehiclesTotal: number;
  vehiclesOnRoad: number;
  vehiclesShop: number;
  vehiclesIdle: number;
};

type Accent = "brand" | "success" | "danger" | "warn" | "info";
type Tile = {
  label: string;
  value: string;
  sub?: string;
  accent: Accent;
};

export function LiveKpiGrid({ kpis }: { kpis: Kpis }) {
  const tiles: Tile[] = [
    { label: "Revenue Today",   value: formatNok(kpis.revenueToday), sub: "Gross turnover",              accent: "success" },
    { label: "Net Profit",      value: formatNok(kpis.netProfit),    sub: `Break-even: ${formatNok(kpis.breakEven)}`, accent: "success" },
    { label: "Active Drivers",  value: `${kpis.driversActive} / ${kpis.driversTotal}`, sub: "Active / total",          accent: "brand"   },
    { label: "Trips Today",     value: String(kpis.tripsToday),      sub: "Completed today",             accent: "brand"   },
    { label: "Vehicles on Road",value: `${kpis.vehiclesOnRoad} / ${kpis.vehiclesTotal}`, sub: `${kpis.vehiclesShop} in shop · ${kpis.vehiclesIdle} idle`, accent: "warn" },
    { label: "Margin",          value: formatPercent(kpis.marginPct),sub: "Net / gross",                 accent: "info"    },
  ];

  return (
    <section
      aria-label="Fleet KPIs"
      className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-6"
    >
      {tiles.map((t) => (
        <Card key={t.label} accent={t.accent}>
          <CardTitle>{t.label}</CardTitle>
          <CardValue className="mt-2">{t.value}</CardValue>
          {t.sub && <CardSub>{t.sub}</CardSub>}
        </Card>
      ))}
    </section>
  );
}

/** Skeleton shown while the RSC fetch is in flight / Suspense boundary. */
export function LiveKpiGridSkeleton() {
  return (
    <section
      aria-label="Loading KPIs"
      className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-6"
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="relative rounded-lg border border-border-muted bg-surface-1 shadow-sm overflow-hidden p-5"
          aria-hidden
        >
          <span className="absolute inset-x-0 top-0 h-[3px] bg-surface-3" />
          <div className="bg-surface-3 h-2.5 w-24 rounded-sm animate-pulse" />
          <div className="bg-surface-3 h-7 w-32 mt-3 rounded-sm animate-pulse" />
          <div className="bg-surface-3 h-2.5 w-20 mt-3 rounded-sm animate-pulse" />
        </div>
      ))}
    </section>
  );
}
