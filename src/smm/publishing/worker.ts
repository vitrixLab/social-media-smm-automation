import Redis from "ioredis";
import { PrismaClient } from "@prisma/client";
import { dequeuePublishJob, getQueueStats, addToDLQ, getDLQLength } from "@/lib/queue";
import { MetaAdapter, LinkedInAdapter, TwitterAdapter } from "@/integrations/adapters";
import { PublishingService } from "@/publishing/service";
import { ModerationService } from "@/moderation/policy";
import { BrandProfile, ContentDraft } from "@/domain/models";
import crypto from "crypto";

const redis = new Redis();
const prisma = new PrismaClient({
  log: process.env.NODE_ENV !== "production" ? ["query", "error", "warn"] : ["error"],
});

const PUBLISH_QUEUE = "smmai:queue:publish";
const DEAD_LETTER_QUEUE = "smmai:dlq:publish";
const FAILURE_COUNTER_PREFIX = "smmai:failure:";

const moderationService = new ModerationService();
const adapters = {
  meta: new MetaAdapter(),
  linkedin: new LinkedInAdapter(),
  x: new TwitterAdapter(),
  // Legacy alias accepted at intake; dispatch stays canonical.
  twitter: new TwitterAdapter(),
} as const;

type ProviderKey = keyof typeof adapters;

function resolveAdapter(platform: string) {
  const key = platform.trim().toLowerCase();
  const canonical = (key === "twitter" ? "x" : key) as ProviderKey;
  return adapters[canonical] ?? null;
}

interface ProcessResult {
  jobId: string;
  status: "succeeded" | "failed" | "retried";
  externalId?: string;
  message?: string;
}

async function processPublishJob(
  event: Awaited<ReturnType<typeof dequeuePublishJob>>["event"]
): Promise<ProcessResult> {
  if (!event) {
    return { jobId: "", status: "failed", message: "No job available" };
  }

  const { jobId, workflowId, workspaceId, socialAccountId, contentRevisionId, idempotencyKey } = event;

  try {
    // Find the draft
    const draft = await prisma.contentDraft.findUnique({
      where: { id: contentRevisionId },
    });

    if (!draft) {
      return {
        jobId,
        status: "failed",
        message: `Draft ${contentRevisionId} not found`,
      };
    }

    // Load the workspace's brand profile from the database.
    // Falls back to empty-string defaults when no profile exists yet so
    // moderation never hard-crashes on a brand-less workspace.
    const brandRow = await prisma.brandProfile.findFirst({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
    });
    const brand = new BrandProfile(
      brandRow?.name || "Default Brand",
      brandRow?.audience || "",
      brandRow?.voice || "",
    );

    // Run moderation
    const moderation = moderationService.validate(draft, brand);

    if (!moderation.approved) {
      // Mark draft as rejected (lowercase enum values per schema).
      await prisma.contentDraft.update({
        where: { id: contentRevisionId },
        data: { status: "rejected" },
      });

      return {
        jobId,
        status: "failed",
        message: "Moderation failed: " + moderation.reasons.join(", "),
      };
    }

    // Publish via the provider adapter for this draft's platform.
    const adapter = resolveAdapter((draft as { platform?: string }).platform ?? "");
    if (!adapter) {
      return {
        jobId,
        status: "failed",
        message: `Unsupported platform for job ${jobId}`,
      };
    }

    // DRY_RUN safety gate: never call a provider unless explicitly disabled.
    const dryRun = process.env.DRY_RUN !== "false";
    if (dryRun) {
      await prisma.contentDraft.update({
        where: { id: contentRevisionId },
        data: { status: "approved" },
      });
      return {
        jobId,
        status: "succeeded",
        message: "dry-run: publish not sent",
      };
    }

    const publishResult = await adapter.publish(draft, { dry_run: false });

    if (publishResult.success) {
      // Update draft status to published (lowercase enum values per schema).
      await prisma.contentDraft.update({
        where: { id: contentRevisionId },
        data: { status: "published" },
      });

      // Record success in publishJob (we'd need to track this, for now just update draft)
      return {
        jobId,
        status: "succeeded",
        externalId: publishResult.external_id,
        message: "Published successfully",
      };
    } else {
      // Check if retryable
      const failureCountStr = await redis.get(`${FAILURE_COUNTER_PREFIX}${jobId}`);
      const failureCount = failureCountStr ? parseInt(failureCountStr) : 0;

      if (failureCount >= 4) {
        // Move to dead-letter queue
        await addToDLQ(jobId, publishResult.message || "Unknown error");
        return {
          jobId,
          status: "failed",
          message: "Moved to dead-letter queue after max retries",
        };
      }

      // Increment failure counter
      await redis.set(
        `${FAILURE_COUNTER_PREFIX}${jobId}`,
        String(failureCount + 1),
        "EX",
        86400
      );

      return {
        jobId,
        status: "retried",
        message: `Failed (${failureCount + 1}/5): ${publishResult.message || "Unknown error"}`,
      };
    }
  } catch (error) {
    console.error(`Publish worker error for job ${jobId}:`, error);
    return {
      jobId,
      status: "failed",
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function publishWorkerLoop() {
  console.log("Publish worker started");

  while (true) {
    try {
      const { jobId, event } = await dequeuePublishJob();

      if (event) {
        const result = await processPublishJob(event);

        // If job succeeded or moved to DLQ, remove from queue
        if (result.status === "succeeded" || result.status === "failed") {
          await redis.del(`${PUBLISH_QUEUE}:${jobId}`);
          await redis.zrem(PUBLISH_QUEUE, jobId);
        }
      } else {
        // No job available, short sleep
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.error("Publish worker loop error:", error);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

// Start the worker
publishWorkerLoop().catch((err) => {
  console.error("Fatal publish worker error:", err);
  process.exit(1);
});

export {};