import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const logs = await prisma.fuelLog.findMany({
    orderBy: { filledAt: "desc" },
    include: {
      vehicle: { select: { plateNumber: true, make: true, model: true } },
    },
  });

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

  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="fuel-logs-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
