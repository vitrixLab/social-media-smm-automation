import { PrismaClient } from "@prisma/client";
import {
  ackPublishJob,
  addToDLQ,
  dequeuePublishJob,
  renewPublishLease,
  retryPublishJob,
} from "@/lib/queue";
import { MetaAdapter, LinkedInAdapter, TwitterAdapter } from "@/integrations/adapters";
import { ModerationService } from "@/moderation/policy";
import { BrandProfile } from "@/domain/models";

const prisma = new PrismaClient({
  log: process.env.NODE_ENV !== "production" ? ["query", "error", "warn"] : ["error"],
});

const moderationService = new ModerationService();
const adapters = {
  meta: new MetaAdapter(),
  linkedin: new LinkedInAdapter(),
  x: new TwitterAdapter(),
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
  if (!event) return { jobId: "", status: "failed", message: "No job available" };

  const { jobId, workspaceId, contentRevisionId } = event;
  let providerCallStarted = false;

  try {
    const draft = await prisma.contentDraft.findUnique({ where: { id: contentRevisionId } });
    if (!draft) {
      return { jobId, status: "failed", message: `Draft ${contentRevisionId} not found` };
    }

    const brandRow = await prisma.brandProfile.findFirst({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
    });
    const brand = new BrandProfile(
      brandRow?.name || "Default Brand",
      brandRow?.audience || "",
      brandRow?.voice || "",
    );
    const moderation = moderationService.validate(draft, brand);

    if (!moderation.approved) {
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

    const adapter = resolveAdapter((draft as { platform?: string }).platform ?? "");
    if (!adapter) return { jobId, status: "failed", message: `Unsupported platform for job ${jobId}` };

    // Live publishing remains behind the existing explicit DRY_RUN=false switch.
    if (process.env.DRY_RUN !== "false") {
      await prisma.contentDraft.update({
        where: { id: contentRevisionId },
        data: { status: "approved" },
      });
      return { jobId, status: "succeeded", message: "dry-run: publish not sent" };
    }

    // Once a provider call starts, a thrown error can mean the post was accepted
    // but the response/persistence was lost. Do not automatically republish it.
    providerCallStarted = true;
    const publishResult = await adapter.publish(draft, { dry_run: false });

    if (!publishResult.success) {
      return {
        jobId,
        status: "retried",
        message: publishResult.message || "Provider returned an unsuccessful result",
      };
    }

    if (!publishResult.external_id || !publishResult.external_id.trim()) {
      return {
        jobId,
        status: "failed",
        message: "Provider reported success without an external ID; manual reconciliation required",
      };
    }

    await prisma.contentDraft.update({
      where: { id: contentRevisionId },
      data: { status: "published" },
    });
    return {
      jobId,
      status: "succeeded",
      externalId: publishResult.external_id,
      message: "Published successfully",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Publish worker error for job ${jobId}:`, error);
    // Pre-provider infrastructure errors are retryable. A thrown error after
    // the provider call begins is ambiguous and goes to DLQ for reconciliation.
    return {
      jobId,
      status: providerCallStarted ? "failed" : "retried",
      message: providerCallStarted
        ? `Ambiguous publish outcome; manual reconciliation required: ${message}`
        : message,
    };
  }
}

async function publishWorkerLoop() {
  console.log("Publish worker started");
  while (true) {
    try {
      const { jobId, event } = await dequeuePublishJob();
      if (!event) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }

      // Renew the visibility lease during long provider/database operations.
      const leaseHeartbeat = setInterval(() => {
        void renewPublishLease(jobId).catch((error) => {
          console.error(`Failed to renew publish lease for ${jobId}:`, error);
        });
      }, 30_000);

      try {
        const result = await processPublishJob(event);
        if (result.status === "succeeded") {
          // Ack only after any required DB status update completed.
          await ackPublishJob(jobId);
        } else if (result.status === "retried") {
          const retry = await retryPublishJob(jobId, result.message || "Retryable publish failure");
          if (!retry.retried) {
            console.error(`Publish job ${jobId} exhausted retries: ${retry.reason}`);
          }
        } else {
          await addToDLQ(jobId, result.message || "Terminal publish failure");
        }
      } finally {
        clearInterval(leaseHeartbeat);
      }
    } catch (error) {
      // If the worker dies before it can acknowledge/retry, the visibility lease
      // expires and dequeuePublishJob will recover the claim.
      console.error("Publish worker loop error:", error);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

publishWorkerLoop().catch((err) => {
  console.error("Fatal publish worker error:", err);
  process.exit(1);
});

export {};
