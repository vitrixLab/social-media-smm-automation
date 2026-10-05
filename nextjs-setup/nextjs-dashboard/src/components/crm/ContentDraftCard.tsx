"use client";

import React from "react";
import { ContentDraft, DraftStatus } from "@/lib/crm";
import StatusPill from "@/components/ui/StatusPill";

interface ContentDraftCardProps {
  draft?: ContentDraft;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  onPublish?: (id: string, platform: string) => void;
  onEdit?: (id: string) => void;
  onUpdateStatus?: (id: string, status: DraftStatus) => void;
  compact?: boolean;
}

const platformLabels: Record<string, string> = { meta: "Meta", instagram: "Instagram", linkedin: "LinkedIn", x: "X", twitter: "X", tiktok: "TikTok", youtube: "YouTube" };

function extractReviewNote(metadata: unknown): string | undefined {
  if (metadata && typeof metadata === "object") {
    const note = (metadata as Record<string, unknown>).lastReviewNote;
    return typeof note === "string" && note.length > 0 ? note : undefined;
  }
  return undefined;
}

export default function ContentDraftCard({
  draft: draftData,
  onApprove = () => {},
  onReject = () => {},
  onPublish = () => {},
  onEdit = () => {},
  onUpdateStatus = () => {},
  compact = false,
}: ContentDraftCardProps) {
  const [publishing, setPublishing] = React.useState(false);
  const [publishMessage, setPublishMessage] = React.useState("");
  const [dryRun, setDryRun] = React.useState(true);

  React.useEffect(() => {
    fetch("/api/crm/status", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (typeof data.dryRun === "boolean") setDryRun(data.dryRun);
      })
      .catch(() => undefined);
  }, []);

  const draft = draftData || {
    id: "unknown",
    topic: "No draft selected",
    text: "",
    platform: "unknown",
    status: "draft" as DraftStatus,
    hashtags: [],
    author: "System",
    createdAt: new Date(),
  };

  const lastReviewNote = extractReviewNote(
    "metadata" in draft ? (draft as { metadata?: unknown }).metadata : undefined,
  );

  async function createPublishJob() {
    setPublishing(true);
    setPublishMessage("");
    try {
      const idempotencyKey = typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}-${draft.id}`;
      const res = await fetch("/api/crm/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ draftId: draft.id, platform: draft.platform }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to create publish job.");
      setPublishMessage(
        data.dryRun === false
          ? "Publish job queued. Delivery status will update asynchronously."
          : "Simulation queued (DRY-RUN). No provider received a live request; the draft returns to approved.",
      );
      onPublish(draft.id, draft.platform);
      onUpdateStatus(draft.id, "scheduled");
    } catch (error) {
      setPublishMessage(error instanceof Error ? error.message : "Unable to create publish job.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <article className="card" style={{ padding: compact ? "1rem" : "1.25rem", display: "flex", flexDirection: "column", gap: "0.9rem", borderColor: draft.status === "pending" ? "rgba(245,158,11,0.35)" : "var(--line)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}>
        <span style={{ display: "inline-flex", alignItems: "center", minHeight: 28, padding: "0.2rem 0.55rem", border: "1px solid var(--line)", borderRadius: "var(--radius-small)", background: "var(--surface)", color: "var(--primary)", fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {platformLabels[draft.platform] || draft.platform}
        </span>
        <StatusPill status={draft.status} />
      </div>

      <div>
        <h3 style={{ margin: 0, fontSize: compact ? "var(--text-sm)" : "var(--text-md)", fontWeight: "var(--weight-bold)", lineHeight: "var(--lh-snug)" }}>{draft.topic}</h3>
        <p style={{ margin: "0.45rem 0 0", color: "var(--muted)", fontSize: "var(--text-xs)" }}>
          {draft.author ? "By " + draft.author + " · " : ""}{new Date(draft.createdAt).toLocaleDateString()}
        </p>
      </div>

      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius-small)", padding: compact ? "0.65rem" : "0.85rem", color: "var(--text)", fontSize: "var(--text-sm)", lineHeight: "var(--lh-normal)", whiteSpace: "pre-wrap" }}>
        {draft.text || "No copy has been added yet."}
      </div>

      {draft.hashtags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
          {draft.hashtags.map((tag) => <span key={tag} style={{ padding: "0.15rem 0.45rem", borderRadius: "var(--radius-small)", background: "var(--primary-light)", color: "var(--primary)", fontSize: "var(--text-xs)" }}>{tag}</span>)}
        </div>
      )}

      {typeof draft.engagementScore === "number" && (
        <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>AI signal <strong style={{ color: "var(--text)" }}>{draft.engagementScore}/100</strong></div>
      )}

      {lastReviewNote && (
        <div role="note" aria-label="Latest revision note" style={{ padding: "0.55rem 0.65rem", borderRadius: "var(--radius-small)", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.35)", color: "var(--text)", fontSize: "var(--text-xs)" }}>
          <strong style={{ color: "var(--accent)" }}>Revision note:</strong> {lastReviewNote}
        </div>
      )}

      {publishMessage && <div role="status" style={{ padding: "0.55rem 0.65rem", borderRadius: "var(--radius-small)", background: "var(--surface)", border: "1px solid var(--line)", color: "var(--muted)", fontSize: "var(--text-xs)" }}>{publishMessage}</div>}

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: "0.8rem", marginTop: "auto" }}>
        {draft.status === "pending" && <>
          <button type="button" className="btn primary" style={{ flex: "1 1 150px", padding: "0.5rem 0.7rem", fontSize: "var(--text-xs)" }} onClick={() => onApprove(draft.id)}>Approve</button>
          <button type="button" className="btn secondary" style={{ padding: "0.5rem 0.7rem", fontSize: "var(--text-xs)" }} onClick={() => onReject(draft.id)}>Reject</button>
        </>}

        {draft.status === "approved" && <>
          <button type="button" className="btn primary" disabled={publishing} style={{ flex: "1 1 180px", padding: "0.5rem 0.7rem", fontSize: "var(--text-xs)", opacity: publishing ? 0.65 : 1 }} onClick={() => void createPublishJob()}>{publishing ? "Queueing…" : dryRun ? "Simulate publish (dry-run)" : "Queue for publishing"}</button>
          <button type="button" className="btn secondary" style={{ padding: "0.5rem 0.7rem", fontSize: "var(--text-xs)" }} onClick={() => onEdit(draft.id)}>Return to draft</button>
        </>}

        {draft.status === "draft" && <button type="button" className="btn secondary" style={{ width: "100%", padding: "0.5rem 0.7rem", fontSize: "var(--text-xs)" }} onClick={() => onUpdateStatus(draft.id, "pending")}>Submit for review</button>}
        {draft.status === "rejected" && <button type="button" className="btn secondary" style={{ width: "100%", padding: "0.5rem 0.7rem", fontSize: "var(--text-xs)" }} onClick={() => onUpdateStatus(draft.id, "draft")}>Reopen as draft</button>}
        {draft.status === "scheduled" && <span style={{ color: "var(--accent)", fontSize: "var(--text-xs)", alignSelf: "center" }}>Queued for delivery</span>}
        {draft.status === "published" && <span style={{ color: "var(--primary)", fontSize: "var(--text-xs)", alignSelf: "center" }}>Published status received</span>}
      </div>
    </article>
  );
}
