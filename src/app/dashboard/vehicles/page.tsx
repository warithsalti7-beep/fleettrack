import { prisma } from "@/lib/prisma";
import { Topbar } from "@/components/layout/topbar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, getStatusColor } from "@/lib/utils";
import { Car, Gauge, Fuel } from "lucide-react";

async function getVehicles() {
  return prisma.vehicle.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      trips: { where: { status: "COMPLETED" }, select: { id: true } },
      drivers: { include: { driver: { select: { name: true } } }, take: 1 },
    },
  });
}

export default async function VehiclesPage() {
  const vehicles = await getVehicles();

  const stats = {
    total: vehicles.length,
    available: vehicles.filter((v) => v.status === "AVAILABLE").length,
    onTrip: vehicles.filter((v) => v.status === "ON_TRIP").length,
    maintenance: vehicles.filter((v) => v.status === "MAINTENANCE").length,
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <Topbar title="Vehicles" subtitle={`${stats.total} vehicles in fleet`} />
      <main className="flex-1 p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Total Fleet", value: stats.total, color: "bg-blue-50 text-blue-700" },
            { label: "Available", value: stats.available, color: "bg-green-50 text-green-700" },
            { label: "On Trip", value: stats.onTrip, color: "bg-blue-50 text-blue-700" },
            { label: "Maintenance", value: stats.maintenance, color: "bg-yellow-50 text-yellow-700" },
          ].map((s) => (
            <div key={s.label} className={`rounded-lg p-4 ${s.color}`}>
              <div className="text-2xl font-bold">{s.value}</div>
              <div className="text-sm font-medium mt-0.5 opacity-80">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Table */}
        <Card className="bg-white">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Fuel Type</TableHead>
                  <TableHead>Fuel Level</TableHead>
                  <TableHead>Mileage</TableHead>
                  <TableHead>Assigned Driver</TableHead>
                  <TableHead>Next Service</TableHead>
                  <TableHead>Trips</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicles.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-gray-400">
                      No vehicles found. Add your first vehicle to get started.
                    </TableCell>
                  </TableRow>
                )}
                {vehicles.map((vehicle) => (
                  <TableRow key={vehicle.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100">
                          <Car className="h-4 w-4 text-gray-600" />
                        </div>
                        <div>
                          <div className="font-medium text-gray-900">
                            {vehicle.year} {vehicle.make} {vehicle.model}
                          </div>
                          <div className="text-xs text-gray-500">{vehicle.color}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono font-semibold text-gray-800">
                        {vehicle.plateNumber}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${getStatusColor(vehicle.status)}`}>
                        {vehicle.status.replace("_", " ")}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-gray-600">{vehicle.fuelType}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 rounded-full bg-gray-200">
                          <div
                            className={`h-1.5 rounded-full ${vehicle.fuelLevel > 50 ? "bg-green-500" : vehicle.fuelLevel > 20 ? "bg-yellow-500" : "bg-red-500"}`}
                            style={{ width: `${vehicle.fuelLevel}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-600">{vehicle.fuelLevel.toFixed(0)}%</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm text-gray-600">
                        <Gauge className="h-3.5 w-3.5" />
                        {vehicle.mileage.toLocaleString()} km
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-gray-600">
                        {vehicle.drivers[0]?.driver.name ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-gray-600">
                        {vehicle.nextService ? formatDate(vehicle.nextService) : "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium text-gray-900">{vehicle.trips.length}</span>
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
