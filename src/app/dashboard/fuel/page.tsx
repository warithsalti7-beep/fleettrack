import { prisma } from "@/lib/prisma";
import { Topbar } from "@/components/layout/topbar";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import { getCurrency } from "@/lib/currency-server";
import { formatAmount, formatAmountDetailed } from "@/lib/currency";
import { ExportButton } from "@/components/ui/export-button";
import { SortBar } from "@/components/ui/sort-bar";
import { Fuel, DollarSign, Droplets, TrendingDown } from "lucide-react";

type FuelSortField = "filledAt" | "liters" | "totalCost" | "pricePerLiter";

const SORT_OPTIONS = [
  { value: "filledAt", label: "Date" },
  { value: "liters", label: "Liters" },
  { value: "totalCost", label: "Total Cost" },
  { value: "pricePerLiter", label: "Price/Liter" },
];

async function getFuelData(sort: FuelSortField, dir: "asc" | "desc") {
  const logs = await prisma.fuelLog.findMany({
    orderBy: { [sort]: dir },
    take: 100,
    include: {
      vehicle: { select: { plateNumber: true, make: true, model: true, fuelType: true } },
    },
  });

  const stats = await prisma.fuelLog.aggregate({
    _sum: { totalCost: true, liters: true },
    _avg: { pricePerLiter: true },
    _count: true,
  });

  // Fuel cost by vehicle
  const byVehicle = await prisma.fuelLog.groupBy({
    by: ["vehicleId"],
    _sum: { totalCost: true, liters: true },
    orderBy: { _sum: { totalCost: "desc" } },
    take: 5,
  });

  return { logs, stats, byVehicle };
}

export default async function FuelPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string }>;
}) {
  const params = await searchParams;
  const sort = (SORT_OPTIONS.some((o) => o.value === params.sort) ? params.sort : "filledAt") as FuelSortField;
  const dir = params.dir === "asc" ? "asc" : "desc";

  const [{ logs, stats }, currency] = await Promise.all([getFuelData(sort, dir), getCurrency()]);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <Topbar title="Fuel Management" subtitle="Track fuel consumption and costs" actions={<ExportButton href="/api/export/fuel" label="Export Fuel Logs" />} />
      <main className="flex-1 p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <div className="rounded-lg border bg-white p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-500">Total Fuel Cost</div>
                <div className="text-2xl font-bold text-gray-900 mt-1">
                  {formatAmount(stats._sum.totalCost ?? 0, currency)}
                </div>
              </div>
              <div className="rounded-full bg-yellow-50 p-3">
                <DollarSign className="h-5 w-5 text-yellow-600" />
              </div>
            </div>
          </div>
          <div className="rounded-lg border bg-white p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-500">Total Liters Dispensed</div>
                <div className="text-2xl font-bold text-gray-900 mt-1">
                  {(stats._sum.liters ?? 0).toFixed(0)} L
                </div>
              </div>
              <div className="rounded-full bg-blue-50 p-3">
                <Droplets className="h-5 w-5 text-blue-600" />
              </div>
            </div>
          </div>
          <div className="rounded-lg border bg-white p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-500">Avg. Price per Liter</div>
                <div className="text-2xl font-bold text-gray-900 mt-1">
                  {formatAmountDetailed(stats._avg.pricePerLiter ?? 0, currency)}
                </div>
              </div>
              <div className="rounded-full bg-green-50 p-3">
                <TrendingDown className="h-5 w-5 text-green-600" />
              </div>
            </div>
          </div>
          <div className="rounded-lg border bg-white p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-500">Fill-ups Recorded</div>
                <div className="text-2xl font-bold text-gray-900 mt-1">{stats._count}</div>
              </div>
              <div className="rounded-full bg-purple-50 p-3">
                <Fuel className="h-5 w-5 text-purple-600" />
              </div>
            </div>
          </div>
        </div>

        {/* Sort Bar */}
        <SortBar options={SORT_OPTIONS} currentSort={sort} currentDir={dir} />

        {/* Fuel Logs Table */}
        <Card className="bg-white">
          <CardHeader>
            <CardTitle className="text-base">Fuel Fill-up Logs</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Fuel Type</TableHead>
                  <TableHead>Liters</TableHead>
                  <TableHead>Price / Liter</TableHead>
                  <TableHead>Total Cost</TableHead>
                  <TableHead>Mileage at Fill</TableHead>
                  <TableHead>Station</TableHead>
                  <TableHead>Date & Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-gray-400">
                      No fuel logs found.
                    </TableCell>
                  </TableRow>
                )}
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium text-gray-900">
                          {log.vehicle.make} {log.vehicle.model}
                        </div>
                        <div className="font-mono text-xs text-gray-500">{log.vehicle.plateNumber}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                        log.vehicle.fuelType === "ELECTRIC"
                          ? "bg-green-100 text-green-700"
                          : log.vehicle.fuelType === "PETROL"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-gray-100 text-gray-700"
                      }`}>
                        {log.vehicle.fuelType}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium text-gray-900">{log.liters.toFixed(1)} L</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-gray-600">{formatAmountDetailed(log.pricePerLiter, currency)}</span>
                    </TableCell>
                    <TableCell>
                      <span className="font-semibold text-gray-900">{formatAmount(log.totalCost, currency)}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-gray-600">{log.mileageAtFill.toLocaleString()} km</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-gray-600">{log.station ?? "—"}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-gray-500">{formatDateTime(log.filledAt)}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
