import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/auth-guard";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = await requireStaff(request);
  if (!gate.ok) return gate.response;
  const drivers = await prisma.driver.findMany({
    orderBy: { name: "asc" },
    include: {
      trips: { where: { status: "COMPLETED" }, select: { fare: true } },
    },
  });

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

  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="drivers-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
