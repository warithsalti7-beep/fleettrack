import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/auth-guard";
import { csvResponse, parseExportPage, rowsToCsv } from "@/lib/export-helpers";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = await requireStaff(request);
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const { limit, offset } = parseExportPage(url);

  const [vehicles, total] = await Promise.all([
    prisma.vehicle.findMany({
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
      include: {
        trips: { where: { status: "COMPLETED" }, select: { id: true } },
        drivers: { include: { driver: { select: { name: true } } }, take: 1 },
      },
    }),
    prisma.vehicle.count(),
  ]);

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

  return csvResponse("vehicles", rowsToCsv(rows), total);
}
