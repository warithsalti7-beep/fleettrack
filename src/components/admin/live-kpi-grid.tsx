/**
 * Pure presentational KPI grid — receives live KPI data from a server
 * component and renders 6 cards. No client-side data fetching; no
 * event listeners. Theme follows the existing design tokens so the
 * React page visually matches /dashboard.
 */

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

function formatNok(n: number): string {
  if (!Number.isFinite(n)) return "—";
  // Match the dashboard's Norwegian-style thin-space grouping.
  const rounded = Math.round(n);
  const grouped = Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "\u202F");
  return (rounded < 0 ? "\u2212" : "") + grouped + "\u00a0kr";
}

type Tile = {
  label: string;
  value: string;
  sub?: string;
  accent: string;
};

export function LiveKpiGrid({ kpis }: { kpis: Kpis }) {
  const tiles: Tile[] = [
    {
      label: "Revenue Today",
      value: formatNok(kpis.revenueToday),
      sub: "Gross turnover",
      accent: "#10b981",
    },
    {
      label: "Net Profit",
      value: formatNok(kpis.netProfit),
      sub: `Break-even: ${formatNok(kpis.breakEven)}`,
      accent: "#10b981",
    },
    {
      label: "Active Drivers",
      value: `${kpis.driversActive} / ${kpis.driversTotal}`,
      sub: "Active / total",
      accent: "#3b7ff5",
    },
    {
      label: "Trips Today",
      value: String(kpis.tripsToday),
      sub: "Completed today",
      accent: "#3b7ff5",
    },
    {
      label: "Vehicles on Road",
      value: `${kpis.vehiclesOnRoad} / ${kpis.vehiclesTotal}`,
      sub: `${kpis.vehiclesShop} in shop · ${kpis.vehiclesIdle} idle`,
      accent: "#f59e0b",
    },
    {
      label: "Margin",
      value: `${(kpis.marginPct ?? 0).toFixed(1)}%`,
      sub: "Net / gross",
      accent: "#14b8a6",
    },
  ];

  return (
    <section aria-label="Fleet KPIs" className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
      {tiles.map((t) => (
        <article
          key={t.label}
          className="relative rounded-xl border border-[rgba(255,255,255,0.09)] bg-[#0c0f18] p-5 shadow-sm overflow-hidden"
        >
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 h-[3px]"
            style={{ background: t.accent }}
          />
          <div className="text-[11px] uppercase tracking-wider text-[#8b96b0] font-mono">{t.label}</div>
          <div className="mt-2 text-2xl font-bold text-[#edf0f8] leading-tight">{t.value}</div>
          {t.sub && <div className="mt-1 text-xs text-[#4d5a72]">{t.sub}</div>}
        </article>
      ))}
    </section>
  );
}
