/**
 * Thin wrapper around `prisma.auditLog.create` so every admin mutation
 * has a single, linted call site. Never throws — if the audit write fails,
 * we swallow (after reporting to Sentry) so the primary operation isn't
 * rolled back just because the log couldn't be written.
 */
import { prisma } from "./prisma";
import { captureError } from "./sentry";
import type { SessionPayload } from "./session";

export type AuditInput = {
  action: string; // e.g. "auth.login", "import.drivers", "driver.create"
  target?: string | null;
  meta?: Record<string, unknown> | null;
  ok?: boolean;
  actor?: Pick<SessionPayload, "userId" | "email"> | null;
  ip?: string | null;
};

export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        target: input.target ?? null,
        ...(input.meta !== undefined && input.meta !== null
          ? { meta: input.meta as object }
          : {}),
        ok: input.ok ?? true,
        actorId: input.actor?.userId ?? null,
        actorEmail: input.actor?.email ?? null,
        ip: input.ip ?? null,
      },
    });
  } catch (err) {
    // Fire-and-forget error reporting; never bubble to caller.
    captureError(err, { where: "writeAudit", action: input.action }).catch(() => {});
  }
}
