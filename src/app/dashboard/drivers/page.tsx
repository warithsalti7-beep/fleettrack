import { prisma } from "@/lib/prisma";
import { Topbar } from "@/components/layout/topbar";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, getStatusColor } from "@/lib/utils";
import { getCurrency } from "@/lib/currency-server";
import { formatAmount } from "@/lib/currency";
import { ExportButton } from "@/components/ui/export-button";
import { SortBar } from "@/components/ui/sort-bar";
import { Star, Phone, Mail } from "lucide-react";

type SortField = "name" | "rating" | "totalTrips" | "licenseExpiry" | "joinedAt";

async function getDrivers(sort: SortField, dir: "asc" | "desc") {
  return prisma.driver.findMany({
    orderBy: { [sort]: dir },
    include: {
      trips: { where: { status: "COMPLETED" }, select: { fare: true } },
      vehicles: {
        include: { vehicle: { select: { plateNumber: true, make: true, model: true } } },
        take: 1,
      },
    },
  });
}

const SORT_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "rating", label: "Rating" },
  { value: "totalTrips", label: "Total Trips" },
  { value: "licenseExpiry", label: "License Expiry" },
  { value: "joinedAt", label: "Date Joined" },
];

export default async function DriversPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string }>;
}) {
  const params = await searchParams;
  const sort = (SORT_OPTIONS.some((o) => o.value === params.sort) ? params.sort : "joinedAt") as SortField;
  const dir = params.dir === "asc" ? "asc" : "desc";

  const [drivers, currency] = await Promise.all([getDrivers(sort, dir), getCurrency()]);

  const stats = {
    total: drivers.length,
    available: drivers.filter((d) => d.status === "AVAILABLE").length,
    onTrip: drivers.filter((d) => d.status === "ON_TRIP").length,
    offDuty: drivers.filter((d) => d.status === "OFF_DUTY").length,
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <Topbar title="Drivers" subtitle={`${stats.total} registered drivers`} actions={<ExportButton href="/api/export/drivers" label="Export Drivers" />} />
      <main className="flex-1 p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Total Drivers", value: stats.total, color: "bg-blue-50 text-blue-700" },
            { label: "Available", value: stats.available, color: "bg-green-50 text-green-700" },
            { label: "On Trip", value: stats.onTrip, color: "bg-purple-50 text-purple-700" },
            { label: "Off Duty", value: stats.offDuty, color: "bg-gray-50 text-gray-700" },
          ].map((s) => (
            <div key={s.label} className={`rounded-lg p-4 ${s.color}`}>
              <div className="text-2xl font-bold">{s.value}</div>
              <div className="text-sm font-medium mt-0.5 opacity-80">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Sort Bar */}
        <SortBar options={SORT_OPTIONS} currentSort={sort} currentDir={dir} />

        {/* Table */}
        <Card className="bg-white">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead>Driver</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>License</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead>Assigned Vehicle</TableHead>
                  <TableHead>Total Trips</TableHead>
                  <TableHead>Total Revenue</TableHead>
                  <TableHead>License Expiry</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drivers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-gray-400">
                      No drivers found. Add your first driver to get started.
                    </TableCell>
                  </TableRow>
                )}
                {drivers.map((driver) => {
                  const totalRevenue = driver.trips.reduce((sum, t) => sum + (t.fare ?? 0), 0);
                  const vehicle = driver.vehicles[0]?.vehicle;
                  const isExpiringSoon =
                    new Date(driver.licenseExpiry) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
                  return (
                    <TableRow key={driver.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700 uppercase">
                            {driver.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                          </div>
                          <div>
                            <div className="font-medium text-gray-900">{driver.name}</div>
                            <div className="text-xs text-gray-500">Since {formatDate(driver.joinedAt)}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1 text-xs text-gray-600">
                            <Phone className="h-3 w-3" /> {driver.phone}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-gray-500">
                            <Mail className="h-3 w-3" /> {driver.email}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-sm text-gray-800">{driver.licenseNumber}</span>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${getStatusColor(driver.status)}`}>
                          {driver.status.replace("_", " ")}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Star className="h-3.5 w-3.5 text-yellow-400 fill-yellow-400" />
                          <span className="text-sm font-medium">{driver.rating.toFixed(1)}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {vehicle ? (
                          <span className="text-sm text-gray-600">
                            {vehicle.make} {vehicle.model} · <span className="font-mono">{vehicle.plateNumber}</span>
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">{driver.totalTrips}</span>
                      </TableCell>
                      <TableCell>
                        <span className="font-medium text-green-700">{formatAmount(totalRevenue, currency)}</span>
                      </TableCell>
                      <TableCell>
                        <span className={`text-sm ${isExpiringSoon ? "text-red-600 font-semibold" : "text-gray-600"}`}>
                          {formatDate(driver.licenseExpiry)}
                          {isExpiringSoon && " ⚠"}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
