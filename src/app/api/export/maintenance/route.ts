import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/auth-guard";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = await requireStaff(request);
  if (!gate.ok) return gate.response;
  const records = await prisma.maintenance.findMany({
    orderBy: { scheduledAt: "asc" },
    include: {
      vehicle: { select: { plateNumber: true, make: true, model: true } },
    },
  });

  const rows = [
    ["ID", "Vehicle", "Plate", "Type", "Description", "Priority", "Status", "Scheduled", "Completed", "Cost", "Technician"],
    ...records.map((r) => [
      r.id,
      `${r.vehicle.make} ${r.vehicle.model}`,
      r.vehicle.plateNumber,
      r.type,
      r.description,
      r.priority,
      r.status,
      new Date(r.scheduledAt).toISOString().slice(0, 10),
      r.completedAt ? new Date(r.completedAt).toISOString().slice(0, 10) : "",
      r.cost?.toFixed(2) ?? "",
      r.technicianName ?? "",
    ]),
  ];

  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="maintenance-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
