import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

export type AuditAction =
  | "draft.approved"
  | "draft.rejected"
  | "draft.published"
  | "draft.simulated"
  | "account.connected"
  | "account.disconnected"
  | "account.refresh_failed"
  | "job.queued"
  | "job.failed"
  | "job.dead_lettered"
  | "settings.changed"
  | "auth.login"
  | "auth.login_failed"
  | "auth.logout"
  | "apikey.created"
  | "apikey.revoked"
  | "workflow.triggered"
  | "webhook.received"
  | "webhook.rejected";

export async function writeAuditEvent(input: {
  workspaceId?: string | null;
  actorUserId?: string | null;
  action: AuditAction | (string & {});
  resourceType: string;
  resourceId?: string | null;
  requestId?: string | null;
  ipHash?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        workspaceId: input.workspaceId ?? null,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        requestId: input.requestId ?? null,
        ipHash: input.ipHash ?? null,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (error) {
    console.error("[audit] failed to write event", input.action, error);
  }
}

export function requestIdFromHeaders(request: NextRequest) {
  return request.headers.get("x-request-id") ?? crypto.randomUUID();
}

export function clientIpHash(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 32);
}
