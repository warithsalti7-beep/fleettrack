import { prisma } from "@/lib/prisma";
import { Topbar } from "@/components/layout/topbar";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime, getStatusColor } from "@/lib/utils";
import { getCurrency } from "@/lib/currency-server";
import { formatAmount } from "@/lib/currency";
import { ExportButton } from "@/components/ui/export-button";
import { SortBar } from "@/components/ui/sort-bar";
import { MapPin, Clock, Star } from "lucide-react";

type SortField = "createdAt" | "fare" | "distance" | "duration" | "rating";

async function getTrips(sort: SortField, dir: "asc" | "desc") {
  return prisma.trip.findMany({
    orderBy: { [sort]: dir },
    take: 100,
    include: {
      driver: { select: { name: true } },
      vehicle: { select: { plateNumber: true } },
    },
  });
}

const SORT_OPTIONS = [
  { value: "createdAt", label: "Date" },
  { value: "fare", label: "Fare" },
  { value: "distance", label: "Distance" },
  { value: "duration", label: "Duration" },
  { value: "rating", label: "Rating" },
];

export default async function TripsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string }>;
}) {
  const params = await searchParams;
  const sort = (SORT_OPTIONS.some((o) => o.value === params.sort) ? params.sort : "createdAt") as SortField;
  const dir = params.dir === "desc" ? "desc" : "asc";

  const [trips, currency] = await Promise.all([getTrips(sort, dir), getCurrency()]);

  const stats = {
    total: trips.length,
    completed: trips.filter((t) => t.status === "COMPLETED").length,
    inProgress: trips.filter((t) => t.status === "IN_PROGRESS").length,
    cancelled: trips.filter((t) => t.status === "CANCELLED").length,
    totalRevenue: trips.reduce((s, t) => s + (t.fare ?? 0), 0),
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <Topbar title="Trips" subtitle="Track all taxi trips in your fleet" actions={<ExportButton href="/api/export/trips" label="Export Trips" />} />
      <main className="flex-1 p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-5 gap-4">
          {[
            { label: "Total Trips", value: stats.total, color: "bg-blue-50 text-blue-700" },
            { label: "Completed", value: stats.completed, color: "bg-green-50 text-green-700" },
            { label: "In Progress", value: stats.inProgress, color: "bg-purple-50 text-purple-700" },
            { label: "Cancelled", value: stats.cancelled, color: "bg-red-50 text-red-700" },
            { label: "Revenue", value: formatAmount(stats.totalRevenue, currency), color: "bg-yellow-50 text-yellow-700" },
          ].map((s) => (
            <div key={s.label} className={`rounded-lg p-4 ${s.color}`}>
              <div className="text-xl font-bold">{s.value}</div>
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
                  <TableHead>Trip</TableHead>
                  <TableHead>Driver</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Distance</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Fare</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trips.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-12 text-gray-400">
                      No trips found.
                    </TableCell>
                  </TableRow>
                )}
                {trips.map((trip) => (
                  <TableRow key={trip.id}>
                    <TableCell>
                      <div className="max-w-[200px]">
                        <div className="flex items-center gap-1.5 mb-1">
                          <MapPin className="h-3.5 w-3.5 text-green-500 shrink-0" />
                          <span className="text-sm font-medium text-gray-900 truncate">{trip.pickupAddress}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-red-400 shrink-0" />
                          <span className="text-xs text-gray-500 truncate">{trip.dropoffAddress}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-medium text-gray-900">{trip.driver.name}</span>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-sm text-gray-700">{trip.vehicle.plateNumber}</span>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${getStatusColor(trip.status)}`}>
                        {trip.status.replace("_", " ")}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-gray-600">
                        {trip.distance ? `${trip.distance.toFixed(1)} km` : "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm text-gray-600">
                        {trip.duration ? (
                          <>
                            <Clock className="h-3.5 w-3.5" />
                            {trip.duration} min
                          </>
                        ) : "—"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-semibold text-gray-900">
                        {trip.fare ? formatAmount(trip.fare, currency) : "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        trip.paymentMethod === "CASH"
                          ? "bg-green-50 text-green-700"
                          : trip.paymentMethod === "CARD"
                          ? "bg-blue-50 text-blue-700"
                          : "bg-purple-50 text-purple-700"
                      }`}>
                        {trip.paymentMethod}
                      </span>
                    </TableCell>
                    <TableCell>
                      {trip.rating ? (
                        <div className="flex items-center gap-1">
                          <Star className="h-3.5 w-3.5 text-yellow-400 fill-yellow-400" />
                          <span className="text-sm">{trip.rating.toFixed(1)}</span>
                        </div>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-gray-500">{formatDateTime(trip.createdAt)}</span>
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
