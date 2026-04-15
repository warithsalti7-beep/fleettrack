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

  const [drivers, total] = await Promise.all([
    prisma.driver.findMany({
      orderBy: { name: "asc" },
      skip: offset,
      take: limit,
      include: { trips: { where: { status: "COMPLETED" }, select: { fare: true } } },
    }),
    prisma.driver.count(),
  ]);

  const rows = [
    ["Driver ID", "Name", "Email", "Phone", "License Number", "Status", "Rating", "Total Trips", "Total Revenue", "License Expiry", "Joined"],
    ...drivers.map((d) => {
      const revenue = d.trips.reduce((s, t) => s + (t.fare ?? 0), 0);
      return [
        d.id,
        d.name,
        d.email,
        d.phone,
        d.licenseNumber,
        d.status,
        d.rating.toFixed(1),
        d.totalTrips.toString(),
        revenue.toFixed(2),
        new Date(d.licenseExpiry).toISOString().slice(0, 10),
        new Date(d.joinedAt).toISOString().slice(0, 10),
      ];
    }),
  ];

  return csvResponse("drivers", rowsToCsv(rows), total);
}
