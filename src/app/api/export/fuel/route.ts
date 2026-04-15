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

  const [logs, total] = await Promise.all([
    prisma.fuelLog.findMany({
      orderBy: { filledAt: "desc" },
      skip: offset,
      take: limit,
      include: { vehicle: { select: { plateNumber: true, make: true, model: true } } },
    }),
    prisma.fuelLog.count(),
  ]);

  const rows = [
    ["Log ID", "Vehicle", "Plate", "Liters", "Price/Liter", "Total Cost", "Mileage at Fill (km)", "Station", "Date"],
    ...logs.map((l) => [
      l.id,
      `${l.vehicle.make} ${l.vehicle.model}`,
      l.vehicle.plateNumber,
      l.liters.toFixed(1),
      l.pricePerLiter.toFixed(2),
      l.totalCost.toFixed(2),
      l.mileageAtFill.toString(),
      l.station ?? "",
      new Date(l.filledAt).toISOString(),
    ]),
  ];

  return csvResponse("fuel-logs", rowsToCsv(rows), total);
}
