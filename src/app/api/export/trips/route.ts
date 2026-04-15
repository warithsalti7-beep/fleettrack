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

  const [trips, total] = await Promise.all([
    prisma.trip.findMany({
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
      include: {
        driver: { select: { name: true } },
        vehicle: { select: { plateNumber: true } },
      },
    }),
    prisma.trip.count(),
  ]);

  const rows = [
    ["Trip ID", "Status", "Driver", "Vehicle", "Pickup", "Dropoff", "Distance (km)", "Duration (min)", "Fare", "Payment", "Rating", "Date"],
    ...trips.map((t) => [
      t.id,
      t.status,
      t.driver.name,
      t.vehicle.plateNumber,
      t.pickupAddress,
      t.dropoffAddress,
      t.distance?.toFixed(1) ?? "",
      t.duration?.toString() ?? "",
      t.fare?.toFixed(2) ?? "",
      t.paymentMethod,
      t.rating?.toFixed(1) ?? "",
      new Date(t.createdAt).toISOString(),
    ]),
  ];

  return csvResponse("trips", rowsToCsv(rows), total);
}
