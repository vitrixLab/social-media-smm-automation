import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import prisma from "@/lib/prisma";
import { AUTH_COOKIE_NAME } from "@/lib/auth";
import { checkRateLimit, rateLimitResponse, requireSameOrigin } from "@/lib/security";
import { clientIpHash, requestIdFromHeaders, writeAuditEvent } from "@/lib/audit";

export async function POST(request: NextRequest) {
  const limit = await checkRateLimit(request, { limit: 5, windowSeconds: 60, scope: "auth:login" });
  if (!limit.allowed) return rateLimitResponse(limit);
  if (!requireSameOrigin(request)) return NextResponse.json({ message: "Invalid request origin." }, { status: 403 });

  const requestId = requestIdFromHeaders(request);
  const ipHash = clientIpHash(request);

  try {
    const body = await request.json() as { email?: unknown; password?: unknown };
    const email = typeof body.email === "string" ? body.email.toLowerCase().trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password || email.length > 254 || password.length > 256) {
      return NextResponse.json({ message: "Invalid credentials." }, { status: 401 });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      await writeAuditEvent({
        action: "auth.login_failed",
        resourceType: "user",
        resourceId: email,
        requestId,
        ipHash,
        metadata: { reason: "invalid_credentials" },
      });
      return NextResponse.json({ message: "Invalid credentials." }, { status: 401 });
    }

    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
    if (!membership) return NextResponse.json({ message: "Account is not assigned to a workspace." }, { status: 403 });

    const rawToken = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.session.create({
      data: { userId: user.id, tokenHash: crypto.createHash("sha256").update(rawToken).digest("hex"), expiresAt } as any,
    } as any);

    await writeAuditEvent({
      workspaceId: membership.workspaceId,
      actorUserId: user.id,
      action: "auth.login",
      resourceType: "user",
      resourceId: user.id,
      requestId,
      ipHash,
      metadata: { email: user.email, role: membership.role },
    });

    const response = NextResponse.json({
      user: { id: user.id, email: user.email, role: membership.role },
      workspaceId: membership.workspaceId,
    });
    response.cookies.set(AUTH_COOKIE_NAME, rawToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });
    return response;
  } catch {
    return NextResponse.json({ message: "Unable to sign in." }, { status: 500 });
  }
}
