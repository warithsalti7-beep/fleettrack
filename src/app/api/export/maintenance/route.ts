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

  const [records, total] = await Promise.all([
    prisma.maintenance.findMany({
      orderBy: { scheduledAt: "asc" },
      skip: offset,
      take: limit,
      include: { vehicle: { select: { plateNumber: true, make: true, model: true } } },
    }),
    prisma.maintenance.count(),
  ]);

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

  return csvResponse("maintenance", rowsToCsv(rows), total);
}
