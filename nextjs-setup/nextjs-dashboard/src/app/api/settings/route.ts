import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { verifySession } from "@/lib/auth";
import { checkRateLimit, rateLimitResponse } from "@/lib/security";
import { providerErrorResponse } from "@/lib/integrations";
import { clientIpHash, requestIdFromHeaders, writeAuditEvent } from "@/lib/audit";

/**
 * Phase 2 server-authoritative settings.
 * POST /api/settings persists automation settings (incl. dryRun) to the
 * SystemState singleton and emits a settings.changed audit event.
 */
function readSettings(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return (value ?? {}) as unknown as Record<string, unknown>;
}

export async function GET(request: NextRequest) {
  const limit = await checkRateLimit(request, { limit: 120, windowSeconds: 60, scope: "settings:read" });
  if (!limit.allowed) return rateLimitResponse(limit);
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category"); // general, automation, moderation, branding

  const session = await verifySession(request);
  if (!session.valid) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const workspaceId = session.payload.workspaceId;

  if (category === "automation") {
    // Read persisted automation settings; env values are fallback defaults.
    const state = await prisma.systemState.upsert({
      where: { id: "singleton" },
      update: {},
      create: { id: "singleton" },
    });
    const persisted = readSettings(state.settings);
    return NextResponse.json({
      category: "automation",
      workspaceId,
      dryRun: typeof persisted.dryRun === "boolean" ? persisted.dryRun : process.env.DRY_RUN !== "false",
      aiProvider: typeof persisted.aiProvider === "string" ? persisted.aiProvider : process.env.AI_PROVIDER || "stub",
      moderateEnabled: persisted.moderateEnabled !== false,
      autoPublish: persisted.autoPublish === true,
      rateLimitPerHour: 100,
    });
  }

  if (category === "moderation") {
    // Return moderation settings
    return NextResponse.json({
      category: "moderation",
      workspaceId,
      enabled: true,
      prohibitedTopics: [],
      requiredDisclosures: ["#ad", "#sponsored"],
      strictMode: true,
    });
  }

  if (category === "branding") {
    // Return branding settings
    return NextResponse.json({
      category: "branding",
      workspaceId,
      brandName: "Example Brand",
      voice: "clear and helpful",
      audience: "general audience",
    });
  }

  // Default: general settings
  const generalState = await prisma.systemState.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
  const generalPersisted = readSettings(generalState.settings);
  return NextResponse.json({
    category: "general",
    workspaceId,
    dryRun: typeof generalPersisted.dryRun === "boolean" ? generalPersisted.dryRun : process.env.DRY_RUN !== "false",
    aiProvider: typeof generalPersisted.aiProvider === "string" ? generalPersisted.aiProvider : process.env.AI_PROVIDER || "stub",
    moderateEnabled: generalPersisted.moderateEnabled !== false,
    autoPublish: generalPersisted.autoPublish === true,
    name: "Example Brand",
  });
}

export async function POST(request: NextRequest) {
  const limit = await checkRateLimit(request, { limit: 60, windowSeconds: 60, scope: "settings:write" });
  if (!limit.allowed) return rateLimitResponse(limit);
  try {
    const body = await request.json();
    const { category, data } = body;

    const session = await verifySession(request);
    if (!session.valid) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const workspaceId = session.payload.workspaceId;

    if (!workspaceId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    if (category === "automation") {
      // Persist automation settings server-side; env values remain defaults.
      const patch: Record<string, unknown> = {};
      if (data && typeof data.dryRun === "boolean") patch.dryRun = data.dryRun;
      if (data && typeof data.aiProvider === "string" && data.aiProvider.length <= 64) patch.aiProvider = data.aiProvider;
      if (data && typeof data.moderateEnabled === "boolean") patch.moderateEnabled = data.moderateEnabled;
      if (data && typeof data.autoPublish === "boolean") patch.autoPublish = data.autoPublish;

      const current = await prisma.systemState.upsert({
        where: { id: "singleton" },
        update: {},
        create: { id: "singleton" },
      });
      const merged = { ...readSettings(current.settings), ...patch };
      const saved = await prisma.systemState.update({
        where: { id: "singleton" },
        data: { settings: merged as Prisma.InputJsonObject },
      });
      await writeAuditEvent({
        workspaceId,
        actorUserId: session.payload.userId,
        action: "settings.changed",
        resourceType: "settings",
        resourceId: "automation",
        requestId: requestIdFromHeaders(request),
        ipHash: clientIpHash(request),
        metadata: { category, ...patch },
      });
      const settings = readSettings(saved.settings);
      return NextResponse.json({
        success: true,
        category,
        workspaceId,
        message: "Automation settings updated",
        dryRun: settings.dryRun,
        aiProvider: settings.aiProvider,
      });
    }

    if (category === "moderation") {
      // Update moderation settings
      return NextResponse.json({
        success: true,
        category,
        workspaceId,
        message: "Moderation settings updated",
      });
    }

    if (category === "branding") {
      // Update branding settings
      return NextResponse.json({
        success: true,
        category,
        workspaceId,
        message: "Branding settings updated",
      });
    }

    return NextResponse.json({ error: "Unknown settings category" }, { status: 400 });
  } catch (error) {
    return providerErrorResponse(error, "Failed to update settings");
  }
}

export async function PATCH(request: NextRequest) {
  const limit = await checkRateLimit(request, { limit: 60, windowSeconds: 60, scope: "settings:patch" });
  if (!limit.allowed) return rateLimitResponse(limit);
  try {
    const body = await request.json();
    const { category, key, value } = body as { category?: string; key?: string; value?: unknown };

    const session = await verifySession(request);
    if (!session.valid) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const workspaceId = session.payload.workspaceId;

    if (!workspaceId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    if (category === "automation") {
      // Persist a single key/value pair into the SystemState singleton settings JSON.
      const allowedKeys = ["dryRun", "aiProvider", "moderateEnabled", "autoPublish"] as const;
      type AllowedKey = typeof allowedKeys[number];
      if (!key || !(allowedKeys as readonly string[]).includes(key)) {
        return NextResponse.json({ error: `key must be one of: ${allowedKeys.join(", ")}` }, { status: 400 });
      }
      // Type guard: dryRun/moderateEnabled/autoPublish must be boolean; aiProvider must be string ≤64 chars.
      const isBoolKey = (["dryRun", "moderateEnabled", "autoPublish"] as string[]).includes(key);
      if (isBoolKey && typeof value !== "boolean") {
        return NextResponse.json({ error: `${key} must be a boolean` }, { status: 400 });
      }
      if (key === "aiProvider" && (typeof value !== "string" || (value as string).length > 64)) {
        return NextResponse.json({ error: "aiProvider must be a string ≤ 64 characters" }, { status: 400 });
      }

      const current = await prisma.systemState.upsert({
        where: { id: "singleton" },
        update: {},
        create: { id: "singleton" },
      });
      const merged = { ...readSettings(current.settings), [key as AllowedKey]: value };
      await prisma.systemState.update({
        where: { id: "singleton" },
        data: { settings: merged as Prisma.InputJsonObject },
      });
      await writeAuditEvent({
        workspaceId,
        actorUserId: session.payload.userId,
        action: "settings.changed",
        resourceType: "settings",
        resourceId: "automation",
        requestId: requestIdFromHeaders(request),
        ipHash: clientIpHash(request),
        metadata: { category, key, value },
      });
      return NextResponse.json({ success: true, category, workspaceId, key, value });
    }

    return NextResponse.json({ error: "PATCH is only supported for category=automation" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Failed to update setting" }, { status: 500 });
  }
}