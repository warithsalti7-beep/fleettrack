import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const vehicles = await prisma.vehicle.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      trips: { where: { status: "COMPLETED" }, select: { id: true } },
      drivers: { include: { driver: { select: { name: true } } }, take: 1 },
    },
  });

  const rows = [
    ["Vehicle ID", "Plate", "Make", "Model", "Year", "Color", "Status", "Fuel Type", "Fuel Level (%)", "Mileage (km)", "Assigned Driver", "Next Service", "Total Trips"],
    ...vehicles.map((v) => [
      v.id,
      v.plateNumber,
      v.make,
      v.model,
      v.year.toString(),
      v.color,
      v.status,
      v.fuelType,
      v.fuelLevel.toFixed(0),
      v.mileage.toLocaleString(),
      v.drivers[0]?.driver.name ?? "",
      v.nextService ? new Date(v.nextService).toISOString().slice(0, 10) : "",
      v.trips.length.toString(),
    ]),
  ];

  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="vehicles-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
