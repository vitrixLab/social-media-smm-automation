import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import crypto from "crypto";
import {
  enqueuePublishJob,
  dequeuePublishJob,
  getQueueLength,
  getDLQLength,
  addToDLQ,
  getQueueStats,
} from "@/lib/queue";

export async function POST(req: NextRequest) {
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { draftId, platform } = payload;
  if (typeof draftId !== "string" || typeof platform !== "string") {
    return NextResponse.json(
      { error: "draftId and platform are required" },
      { status: 400 }
    );
  }

  // RBAC: verify draft belongs to current workspace
  const session = await verifySession(req);
  if (!session.valid) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const workspaceId = session.payload.workspaceId;

  const draft = await prisma.contentDraft.findUnique({
    where: { id: draftId },
  });

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  if (draft.workspaceId !== workspaceId) {
    return NextResponse.json(
      { error: "Forbidden: draft does not belong to your workspace" },
      { status: 403 }
    );
  }

  // Generate idempotency key from request components
  const idempotencyKey = crypto
    .createHash("sha256")
    .update(`${draftId}-${platform}-${Date.now()}`)
    .digest("hex");

  // Check if this idempotency key already has a result
  const existingJob = await prisma.publishJob.findFirst({
    where: { idempotencyKey },
  });

  if (existingJob) {
    return NextResponse.json({
      job: { id: existingJob.id, status: existingJob.status },
      idempotencyKey,
      fromCache: true,
    });
  }

  // Create publish job in database (durable persistence)
  const job = await prisma.publishJob.create({
    data: {
      workspaceId,
      draftId: String(draftId),
      platform: String(platform),
      status: "PENDING",
      idempotencyKey,
    },
  });

  // Update draft status to SCHEDULED
  await prisma.contentDraft.update({
    where: { id: String(draftId) },
    data: { status: "SCHEDULED" },
  });

  // Enqueue to durable Redis queue for background processing
  const publishedJob = await enqueuePublishJob({
    type: "publish.requested",
    version: 1,
    jobId: job.id,
    workflowId: "default",
    workspaceId,
    socialAccountId: platform,
    contentRevisionId: draftId,
    idempotencyKey,
  });

  return NextResponse.json({ job, idempotencyKey }, { status: 201 });
}

// Optional: endpoint to check queue status
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");

  if (action === "stats") {
    const stats = await getQueueStats();
    return NextResponse.json(stats);
  }

  if (action === "queue-length") {
    const length = await getQueueLength();
    return NextResponse.json({ pending: length });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}