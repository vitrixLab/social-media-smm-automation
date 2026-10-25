// Redis-backed publishing queue with recoverable worker leases.
// Claimed jobs stay in the processing ZSET until acknowledged, retried, or
// dead-lettered. Expired leases are returned to the pending ZSET atomically.

import Redis from "ioredis";

let redis: Redis | undefined;

const getRedis = (): Redis => {
  if (redis) return redis;
  const connectionString = process.env.REDIS_URL;
  if (!connectionString) throw new Error("REDIS_URL is not configured");
  redis = new Redis(connectionString, {
    lazyConnect: true,
    connectTimeout: 1500,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  redis.on("error", () => {
    // Command failures are surfaced to callers.
  });
  return redis;
};

const ensureConnected = async (): Promise<void> => {
  const client = getRedis();
  if (client.status === "wait" || client.status === "close" || client.status === "end") {
    await client.connect();
  }
};

const PUBLISH_QUEUE = "smmai:queue:publish";
const PROCESSING_QUEUE = "smmai:queue:publish:processing";
const DEAD_LETTER_QUEUE = "smmai:dlq:publish";
const FAILURE_COUNTER_PREFIX = "smmai:failure:";
const FAILURE_REASON_PREFIX = "smmai:failure-reason:";
const DEAD_LETTER_REASON_PREFIX = "smmai:dlq:reason:";
const JOB_TTL_SECONDS = 7 * 24 * 60 * 60;
const FAILURE_TTL_SECONDS = 24 * 60 * 60;
const VISIBILITY_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 5;

export type PublishJobEvent = {
  type: "publish.requested";
  version: 1;
  jobId: string;
  workflowId: string;
  workspaceId: string;
  socialAccountId: string;
  contentRevisionId: string;
  idempotencyKey: string;
};

export type RetryResult =
  | { retried: true; attempt: number; delayMs: number }
  | { retried: false; attempt: number; reason: string };

export const retryDelayMs = (attempt: number): number => {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(5 * 60_000, 2 ** (safeAttempt - 1) * 1_000);
};

export const enqueuePublishJob = async (event: PublishJobEvent): Promise<string> => {
  await ensureConnected();
  const key = `${PUBLISH_QUEUE}:${event.jobId}`;
  await getRedis().eval(
    `if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
     redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
     redis.call('ZADD', KEYS[2], ARGV[3], ARGV[4])
     return 1`,
    2, key, PUBLISH_QUEUE, JSON.stringify(event), String(JOB_TTL_SECONDS),
    String(Date.now()), event.jobId,
  );
  return event.jobId;
};

/**
 * Recover expired leases and claim one due job atomically.
 * This restores job delivery after a worker crash; it is not exactly-once
 * provider publishing. An interrupted provider call can still be ambiguous.
 */
export const dequeuePublishJob = async (): Promise<{
  jobId: string;
  event: PublishJobEvent | null;
}> => {
  await ensureConnected();
  const now = Date.now();
  const claimed = (await getRedis().eval(
    `local expired = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', ARGV[1])
     for _, id in ipairs(expired) do
       redis.call('ZREM', KEYS[2], id)
       redis.call('ZADD', KEYS[1], ARGV[1], id)
     end
     local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 1)
     if #due == 0 then return '' end
     local id = due[1]
     redis.call('ZREM', KEYS[1], id)
     redis.call('ZADD', KEYS[2], ARGV[2], id)
     return id`,
    2, PUBLISH_QUEUE, PROCESSING_QUEUE, String(now), String(now + VISIBILITY_TIMEOUT_MS),
  )) as string;

  if (!claimed) return { jobId: "", event: null };
  const raw = await getRedis().get(`${PUBLISH_QUEUE}:${claimed}`);
  if (!raw) {
    await getRedis().zrem(PROCESSING_QUEUE, claimed);
    return { jobId: claimed, event: null };
  }

  try {
    return { jobId: claimed, event: JSON.parse(raw) as PublishJobEvent };
  } catch {
    await addToDLQ(claimed, "Invalid queued job payload");
    return { jobId: claimed, event: null };
  }
};

/** Extend a live claim while the worker is still processing it. */
export const renewPublishLease = async (jobId: string): Promise<boolean> => {
  await ensureConnected();
  return Number(await getRedis().eval(
    `if redis.call('ZSCORE', KEYS[1], ARGV[1]) == false then return 0 end
     redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
     return 1`,
    1, PROCESSING_QUEUE, jobId, String(Date.now() + VISIBILITY_TIMEOUT_MS),
  )) === 1;
};

/** Acknowledge only after the worker has persisted its required result. */
export const ackPublishJob = async (jobId: string): Promise<void> => {
  await ensureConnected();
  await getRedis().eval(
    `redis.call('ZREM', KEYS[1], ARGV[1])
     redis.call('ZREM', KEYS[2], ARGV[1])
     redis.call('DEL', KEYS[3], KEYS[4], KEYS[5])
     return 1`,
    5, PROCESSING_QUEUE, PUBLISH_QUEUE, `${PUBLISH_QUEUE}:${jobId}`,
    `${FAILURE_COUNTER_PREFIX}${jobId}`, `${FAILURE_REASON_PREFIX}${jobId}`, jobId,
  );
};

export const retryPublishJob = async (jobId: string, reason: string): Promise<RetryResult> => {
  await ensureConnected();
  const client = getRedis();
  const attempt = await client.incr(`${FAILURE_COUNTER_PREFIX}${jobId}`);
  await client.expire(`${FAILURE_COUNTER_PREFIX}${jobId}`, FAILURE_TTL_SECONDS);
  await client.set(`${FAILURE_REASON_PREFIX}${jobId}`, reason, "EX", FAILURE_TTL_SECONDS);

  if (attempt >= MAX_ATTEMPTS) {
    await addToDLQ(jobId, reason);
    return { retried: false, attempt, reason };
  }

  const delayMs = retryDelayMs(attempt);
  await client.eval(
    `redis.call('ZREM', KEYS[1], ARGV[1])
     redis.call('ZADD', KEYS[2], ARGV[2], ARGV[1])
     return 1`,
    2, PROCESSING_QUEUE, PUBLISH_QUEUE, jobId, String(Date.now() + delayMs),
  );
  return { retried: true, attempt, delayMs };
};

/** Persist terminal failures for inspection; retain payload for manual recovery. */
export const addToDLQ = async (jobId: string, reason: string): Promise<void> => {
  await ensureConnected();
  await getRedis().eval(
    `redis.call('ZREM', KEYS[1], ARGV[1])
     redis.call('ZREM', KEYS[2], ARGV[1])
     redis.call('ZADD', KEYS[3], ARGV[2], ARGV[1])
     redis.call('SET', KEYS[4], ARGV[3], 'EX', ARGV[4])
     return 1`,
    4, PROCESSING_QUEUE, PUBLISH_QUEUE, DEAD_LETTER_QUEUE,
    `${DEAD_LETTER_REASON_PREFIX}${jobId}`, jobId, String(Date.now()), reason,
    String(FAILURE_TTL_SECONDS),
  );
};

export const getQueueLength = async (): Promise<number> => {
  await ensureConnected();
  return getRedis().zcard(PUBLISH_QUEUE);
};

export const getDLQLength = async (): Promise<number> => {
  await ensureConnected();
  return getRedis().zcard(DEAD_LETTER_QUEUE);
};

export const getQueueStats = async (): Promise<{ pending: number; failed: number }> => ({
  pending: await getQueueLength(),
  failed: await getDLQLength(),
});
