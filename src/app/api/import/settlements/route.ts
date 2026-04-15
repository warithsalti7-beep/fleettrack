import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseCsv, asStr, asFloat, asDate } from "@/lib/csv";
import { runImport } from "@/lib/import";
import { matchDriver } from "@/lib/matching";

/**
 * POST /api/import/settlements?source=BOLT|UBER|DISPATCHER|MANUAL
 *
 * Weekly payout sheet → SettlementRawRow (audit) →
 *   Settlement (one row per driver+source+periodStart+periodEnd).
 *
 * The unique constraint
 *   @@unique([driverId, source, periodStart, periodEnd])
 * makes re-uploading the same week's sheet a safe UPSERT.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const get = (r: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) {
    const v = r[k] ?? r[k.toLowerCase()] ?? r[k.toUpperCase()];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
  }
  return null;
};

export async function POST(req: NextRequest) {
  return runImport("settlements", req, async (csv, report) => {
    const url = new URL(req.url);
    const source = (url.searchParams.get("source") || "MANUAL").toUpperCase();
    if (!["BOLT", "UBER", "DISPATCHER", "MANUAL"].includes(source)) {
      report.errors.push({ row: 0, message: `Unknown ?source=${source}` });
      return;
    }
    const rows = parseCsv(csv);
    const importBatchId = `settle-${source.toLowerCase()}-${Date.now()}`;
    const fileName = req.headers.get("x-file-name") || null;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const driverEmail = get(r, "driver_email", "Driver email", "Email")?.toLowerCase() ?? null;
      const driverName = get(r, "driver_name", "Driver name", "Driver");
      const externalDriverCode = get(r, "driver_id", "Driver ID", "driver_uuid");
      const periodStart = asDate(get(r, "period_start", "Period start", "Week start"));
      const periodEnd = asDate(get(r, "period_end", "Period end", "Week end"));
      const grossRevenue = asFloat(get(r, "gross_revenue", "Gross", "Total gross"));
      const platformCommission = asFloat(
        get(r, "platform_commission", "Commission", "Bolt commission", "Uber fee"),
      ) ?? 0;
      const netRevenue = asFloat(get(r, "net_revenue", "Net", "Net earnings"));
      const bonusTotal = asFloat(get(r, "bonus", "Bonus", "Incentives")) ?? 0;
      const deductionsTotal = asFloat(get(r, "deductions", "Deductions", "Charges")) ?? 0;
      const payoutTotal = asFloat(
        get(r, "payout_total", "Payout", "Net payout", "To driver"),
      );
      const vatTotal = asFloat(get(r, "vat", "VAT", "MVA"));

      // Stage raw row first.
      let rawId: string | null = null;
      try {
        const created = await (prisma as never as { settlementRawRow: { create: (a: unknown) => Promise<{ id: string }> } })
          .settlementRawRow.create({
            data: {
              importBatchId,
              source,
              fileName,
              rowNumber: i + 2,
              rawPayload: r as never,
              driverEmail,
              periodStart,
              periodEnd,
              grossRevenue,
              platformCommission,
              netRevenue,
              bonusTotal,
              deductionsTotal,
              payoutTotal,
              vatTotal,
            },
          });
        rawId = created.id;
      } catch (e) {
        report.errors.push({
          row: i + 2,
          message: `raw stage failed: ${e instanceof Error ? e.message : String(e)}`,
        });
        continue;
      }

      if (!periodStart || !periodEnd || grossRevenue == null || payoutTotal == null) {
        report.errors.push({
          row: i + 2,
          message: "Missing period_start, period_end, gross_revenue or payout_total",
        });
        continue;
      }

      const dm = await matchDriver({
        externalDriverCode,
        email: driverEmail,
        fullName: driverName,
      });
      if (!dm.driverId) {
        report.errors.push({
          row: i + 2,
          email_or_id: driverEmail || driverName || "",
          message: "No matching driver — import drivers master first or include driver_id",
        });
        continue;
      }

      const data = {
        driverId: dm.driverId,
        source,
        periodStart,
        periodEnd,
        grossRevenue,
        platformCommission,
        netRevenue:
          netRevenue ?? Math.max(0, grossRevenue - platformCommission),
        bonusTotal,
        deductionsTotal,
        payoutTotal,
        vatTotal,
        importBatchId,
      };
      try {
        // Upsert on (driverId, source, periodStart, periodEnd) — see the
        // @@unique constraint on Settlement.
        const existing = await (prisma as never as { settlement: { findFirst: (a: unknown) => Promise<{ id: string } | null> } })
          .settlement.findFirst({
            where: {
              driverId: dm.driverId,
              source,
              periodStart,
              periodEnd,
            },
          });
        if (existing) {
          await (prisma as never as { settlement: { update: (a: unknown) => Promise<unknown> } })
            .settlement.update({ where: { id: existing.id }, data });
          report.updated++;
        } else {
          await (prisma as never as { settlement: { create: (a: unknown) => Promise<{ id: string }> } })
            .settlement.create({ data });
          report.inserted++;
        }
        if (rawId) {
          await (prisma as never as { settlementRawRow: { update: (a: unknown) => Promise<unknown> } })
            .settlementRawRow.update({
              where: { id: rawId },
              data: { normalizedSettlementId: rawId /* placeholder; updated next */ },
            }).catch(() => {});
        }
      } catch (e) {
        report.errors.push({
          row: i + 2,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  });
}
