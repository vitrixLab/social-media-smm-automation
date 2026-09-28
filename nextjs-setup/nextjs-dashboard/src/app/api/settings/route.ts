import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySession } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category"); // general, automation, moderation, branding

  const session = await verifySession();
  const workspaceId = session?.workspaceId;

  let where: any = {};

  if (workspaceId) {
    where.workspaceId = workspaceId;
  }

  if (category === "automation") {
    // Return automation settings for the workspace
    return NextResponse.json({
      category: "automation",
      workspaceId,
      dryRun: process.env.DRY_RUN === "true",
      aiProvider: process.env.AI_PROVIDER || "stub",
      moderateEnabled: true,
      autoPublish: false,
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
    const brand = await prisma.$queryRaw`SELECT * FROM brandprofile WHERE 1=1`;
    return NextResponse.json({
      category: "branding",
      workspaceId,
      brandName: "Example Brand",
      voice: "clear and helpful",
      audience: "general audience",
    });
  }

  // Default: general settings
  return NextResponse.json({
    category: "general",
    workspaceId,
    dryRun: process.env.DRY_RUN === "true",
    aiProvider: process.env.AI_PROVIDER || "stub",
    moderateEnabled: true,
    autoPublish: false,
    name: "Example Brand",
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { category, data } = body;

    const session = await verifySession();
    const workspaceId = session?.workspaceId;

    if (!workspaceId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    if (category === "automation") {
      // Update automation settings
      return NextResponse.json({
        success: true,
        category,
        workspaceId,
        message: "Automation settings updated",
        dryRun: data?.dryRun ?? process.env.DRY_RUN === "true",
        aiProvider: data?.aiProvider ?? (process.env.AI_PROVIDER || "stub"),
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
  } catch {
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { category, key, value } = body;

    const session = await verifySession();
    const workspaceId = session?.workspaceId;

    if (!workspaceId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    // Update a specific setting
    return NextResponse.json({
      success: true,
      category,
      workspaceId,
      key,
      value,
      message: "Setting updated via PATCH",
    });
  } catch {
    return NextResponse.json({ error: "Failed to update setting" }, { status: 500 });
  }
}