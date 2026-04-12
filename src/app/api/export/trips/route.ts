import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const trips = await prisma.trip.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      driver: { select: { name: true } },
      vehicle: { select: { plateNumber: true } },
    },
  });

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

  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="trips-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
