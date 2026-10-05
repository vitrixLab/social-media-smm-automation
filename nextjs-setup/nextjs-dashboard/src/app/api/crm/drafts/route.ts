import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { checkRateLimit, rateLimitResponse, readJsonWithLimit, requireSameOrigin } from "@/lib/security";
import { clientIpHash, requestIdFromHeaders, writeAuditEvent } from "@/lib/audit";

export async function GET(request: NextRequest) {
  const limit = await checkRateLimit(request, { limit: 120, scope: "crm:drafts:read" });
  if (!limit.allowed) return rateLimitResponse(limit);
  const { searchParams } = new URL(request.url);

  const statusParam = searchParams.get("status");
  const platformParam = searchParams.get("platform");
  const q = searchParams.get("q")?.trim() || undefined;
  const sortParam = searchParams.get("sort") || "created";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const pageLimit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10) || 20));

  const session = await verifySession(request);
  if (!session.valid) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const workspaceId = session.payload.workspaceId;

  // Build server-side WHERE — no in-memory filtering.
  const where: Parameters<typeof prisma.contentDraft.findMany>[0]["where"] = { workspaceId };
  if (statusParam && statusParam !== "all") where.status = statusParam as never;
  if (platformParam && platformParam !== "all") where.platform = platformParam;
  if (q) where.content = { contains: q, mode: "insensitive" };

  const orderBy: Parameters<typeof prisma.contentDraft.findMany>[0]["orderBy"] =
    sortParam === "updated" ? { updatedAt: "desc" }
    : sortParam === "scheduledAt" ? { scheduledAt: "desc" }
    : { createdAt: "desc" };

  const [drafts, total, statusGroups] = await Promise.all([
    prisma.contentDraft.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageLimit,
      take: pageLimit,
    }),
    prisma.contentDraft.count({ where }),
    // Workspace-scoped status counts — independent of the active filter.
    prisma.contentDraft.groupBy({
      by: ["status"],
      where: { workspaceId },
      _count: { status: true },
    }),
  ]);

  const counts: Record<string, number> = { all: 0, pending: 0, approved: 0, draft: 0, rejected: 0, published: 0, scheduled: 0 };
  for (const row of statusGroups) {
    const key = String(row.status);
    counts[key] = (counts[key] ?? 0) + row._count.status;
    counts.all += row._count.status;
  }

  return NextResponse.json({
    drafts,
    pagination: { page, limit: pageLimit, total },
    counts,
  });
}

export async function POST(request: NextRequest) {
  const limit = await checkRateLimit(request, { limit: 60, scope: "crm:drafts:write" });
  if (!limit.allowed) return rateLimitResponse(limit);
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const session = await verifySession(request);
  if (!session.valid) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const body = await readJsonWithLimit<{ topic?: string; platform?: string; text?: string; hashtags?: string[]; author?: string }>(request);
    const newDraft = {
      topic: body.topic || "Untitled Campaign Draft",
      platform: body.platform || "instagram",
      text: body.text || "",
      hashtags: body.hashtags || [],
      status: "pending" as const,
      createdAt: new Date().toISOString(),
      author: body.author || "Marketing Team",
    };

    const draft = await prisma.contentDraft.create({
      data: {
        ...newDraft,
        workspaceId: session.valid ? session.payload.workspaceId : undefined,
      },
    });

    return NextResponse.json({ success: true, draft }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create draft" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const limit = await checkRateLimit(request, { limit: 60, scope: "crm:drafts:write" });
  if (!limit.allowed) return rateLimitResponse(limit);
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const session = await verifySession(request);
  if (!session.valid) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (session.payload.role === "viewer") return NextResponse.json({ error: "Approval permission required" }, { status: 403 });
  const requestId = requestIdFromHeaders(request);
  const clientIp = clientIpHash(request);
  try {
    const body = await request.json() as { topic?: string; platform?: string; text?: string; hashtags?: string[]; clientId?: string; status?: string; author?: string };
    const { id, ids, status, note } = body as { id?: string; ids?: string[]; status: string; note?: string };

    const targets = Array.isArray(ids) ? [...new Set(ids)].slice(0, 20) : id ? [id] : [];
    if (targets.length === 0 || !status) {
      return NextResponse.json({ error: "id (or up to 20 ids) and status are required" }, { status: 400 });
    }
    const nextStatus = status.toLowerCase() as "draft" | "pending" | "approved" | "rejected" | "scheduled" | "published";
    if (!["draft", "pending", "approved", "rejected", "scheduled"].includes(nextStatus)) {
      return NextResponse.json({ error: "Invalid status transition" }, { status: 400 });
    }
    if (nextStatus === "rejected" && (!note || note.trim().length === 0)) {
      return NextResponse.json({ error: "A revision note is required when rejecting" }, { status: 400 });
    }

    const updated = [];
    for (const targetId of targets) {
      // RBAC: verify draft belongs to current workspace
      const existingDraft = await prisma.contentDraft.findUnique({ where: { id: targetId } });
      if (!existingDraft || existingDraft?.workspaceId !== session.payload.workspaceId) {
        return NextResponse.json({ error: `Forbidden: draft ${targetId} does not belong to your workspace` }, { status: 403 });
      }

      const draft = await prisma.contentDraft.update({
        where: { id: targetId },
        data: {
          status: nextStatus,
          metadata: note ? { ...((existingDraft.metadata ?? {}) as Record<string, unknown>), lastReviewNote: note.trim(), lastReviewedAt: new Date().toISOString(), lastReviewedBy: session.payload.userId } : undefined,
        },
      });
      await writeAuditEvent({
        workspaceId: session.payload.workspaceId,
        actorUserId: session.payload.userId,
        action: nextStatus === "approved" ? "draft.approved" : nextStatus === "rejected" ? "draft.rejected" : "settings.changed",
        resourceType: "draft",
        resourceId: targetId,
        requestId,
        ipHash: clientIp,
        metadata: { from: existingDraft.status, to: nextStatus, ...(note ? { note: note.trim() } : {}) },
      });
      updated.push(draft);
    }

    if (updated.length === 1) return NextResponse.json({ success: true, draft: updated[0] });
    return NextResponse.json({ success: true, updated });
  } catch {
    return NextResponse.json({ error: "Failed to update draft" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const limit = await checkRateLimit(request, { limit: 30, scope: "crm:drafts:delete" });
  if (!limit.allowed) return rateLimitResponse(limit);
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const session = await verifySession(request);
  if (!session.valid) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const body = await request.json() as { topic?: string; platform?: string; text?: string; hashtags?: string[]; clientId?: string; status?: string; author?: string };
    const { id } = body as { id: string };

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    // RBAC: verify draft belongs to current workspace
    const existingDraft = await prisma.contentDraft.findUnique({
      where: { id },
    });

    if (existingDraft?.workspaceId !== (session.valid ? session.payload.workspaceId : undefined)) {
      return NextResponse.json(
        { error: "Forbidden: draft does not belong to your workspace" },
        { status: 403 }
      );
    }

    await prisma.contentDraft.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete draft" }, { status: 500 });
  }
}
