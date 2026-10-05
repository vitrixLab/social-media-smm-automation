"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ContentDraft, DraftStatus, Platform } from "@/lib/crm";
import ContentDraftCard from "@/components/crm/ContentDraftCard";

interface ApprovalQueueProps { selectedPlatform: string; dryRun?: boolean; }

const tabs = [
  { id: "all", label: "All items" },
  { id: "pending", label: "Needs review" },
  { id: "approved", label: "Approved" },
  { id: "draft", label: "Drafts" },
  { id: "scheduled", label: "Scheduled" },
  { id: "published", label: "Published" },
  { id: "rejected", label: "Rejected" },
];

export default function ApprovalQueue({ selectedPlatform, dryRun = false }: ApprovalQueueProps) {
  const [drafts, setDrafts] = useState<ContentDraft[]>([]);
  const [activeTab, setActiveTab] = useState("all");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTopic, setNewTopic] = useState("");
  const [newPlatform, setNewPlatform] = useState<Platform>("instagram");
  const [newText, setNewText] = useState("");
  const [newHashtags, setNewHashtags] = useState("#SMMAI, #Growth");
  const [notice, setNotice] = useState("");

  const loadDrafts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const url = new URL("/api/crm/drafts", window.location.origin);
      if (activeTab !== "all") url.searchParams.set("status", activeTab);
      if (selectedPlatform !== "all") url.searchParams.set("platform", selectedPlatform);
      const res = await fetch(url.toString(), { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to load drafts.");
      setDrafts(Array.isArray(data.drafts) ? data.drafts : []);
      setCounts(data.counts || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load drafts.");
      setDrafts([]);
    } finally {
      setLoading(false);
    }
  }, [activeTab, selectedPlatform]);

  useEffect(() => { Promise.resolve().then(() => loadDrafts()); }, [loadDrafts]);

  useEffect(() => {
    if (!showCreateModal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowCreateModal(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showCreateModal]);

  const [selected, setSelected] = useState<string[]>([]);
  const [rejectNote, setRejectNote] = useState("");
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);

  async function handleUpdateStatus(id: string, status: DraftStatus, note?: string) {
    setNotice("");
    try {
      const res = await fetch("/api/crm/drafts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status, ...(note ? { note } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Status update failed.");
      setNotice(status === "approved" ? "Draft approved and ready for publishing." : "Draft status updated.");
      setSelected((prev) => prev.filter((item) => item !== id));
      await loadDrafts();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Status update failed.");
    }
  }

  async function handleBatchApprove() {
    if (selected.length === 0) return;
    setNotice("");
    try {
      const res = await fetch("/api/crm/drafts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selected.slice(0, 20), status: "approved" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Batch approval failed.");
      setNotice(`Approved ${data.updated?.length ?? selected.length} draft(s).`);
      setSelected([]);
      await loadDrafts();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Batch approval failed.");
    }
  }

  async function handleCreateDraft(event: React.FormEvent) {
    event.preventDefault();
    setNotice("");
    try {
      const res = await fetch("/api/crm/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: newTopic.trim(),
          platform: newPlatform,
          text: newText.trim(),
          hashtags: newHashtags.split(",").map((tag) => tag.trim()).filter(Boolean),
          author: "Human Marketer",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Draft creation failed.");
      setShowCreateModal(false);
      setNewTopic("");
      setNewText("");
      setNewHashtags("#SMMAI, #Growth");
      setNotice("Draft created and routed to the approval gate.");
      await loadDrafts();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Draft creation failed.");
    }
  }

  return (
    <section aria-labelledby="approval-queue-heading">
      {dryRun && (
        <div role="status" aria-live="polite" style={{ marginBottom: "1rem", padding: "0.65rem 0.9rem", background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.35)", borderRadius: "var(--radius-small)", color: "#f59e0b", fontSize: "var(--text-xs)", fontWeight: "var(--weight-semibold)" }}>
          Simulate mode — no posts will be published
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: "1rem", marginBottom: "1rem" }}>
        <div>
          <span className="eyebrow">Publishing pipeline</span>
          <h2 id="approval-queue-heading" style={{ margin: 0, fontSize: "var(--text-xl)", fontWeight: "var(--weight-black)" }}>Content review queue</h2>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <div role="group" aria-label="Content view" style={{ display: "inline-flex", border: "1px solid var(--line)", borderRadius: "var(--radius-medium)", padding: 2, background: "var(--surface)" }}>
            {(["grid", "list"] as const).map((mode) => (
              <button key={mode} type="button" aria-pressed={viewMode === mode} onClick={() => setViewMode(mode)}
                style={{ border: 0, borderRadius: "var(--radius-small)", padding: "0.4rem 0.6rem", background: viewMode === mode ? "var(--primary)" : "transparent", color: viewMode === mode ? "var(--bg)" : "var(--muted)", cursor: "pointer", font: "inherit", fontSize: "var(--text-xs)", fontWeight: "var(--weight-semibold)" }}>
                {mode === "grid" ? "Grid" : "List"}
              </button>
            ))}
          </div>
          <button type="button" className="btn primary" style={{ padding: "0.55rem 0.85rem", fontSize: "var(--text-xs)" }} onClick={() => setShowCreateModal(true)}>+ New draft</button>
        </div>
      </div>

      <div role="tablist" aria-label="Draft status" style={{ display: "flex", gap: "0.25rem", overflowX: "auto", borderBottom: "1px solid var(--line)", paddingBottom: "0.5rem", marginBottom: "1rem" }}>
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button key={tab.id} type="button" role="tab" aria-selected={active} onClick={() => setActiveTab(tab.id)}
              style={{ flexShrink: 0, border: "1px solid " + (active ? "rgba(5,150,105,0.35)" : "transparent"), borderRadius: "var(--radius-small)", background: active ? "var(--primary-light)" : "transparent", color: active ? "var(--primary)" : "var(--muted)", padding: "0.4rem 0.65rem", cursor: "pointer", font: "inherit", fontSize: "var(--text-xs)", fontWeight: "var(--weight-semibold)" }}>
              {tab.label} <span style={{ marginLeft: 4, opacity: 0.75 }}>{counts[tab.id] ?? 0}</span>
            </button>
          );
        })}
      </div>

      {notice && <div role="status" style={{ marginBottom: "1rem", padding: "0.65rem 0.8rem", border: "1px solid var(--line)", borderRadius: "var(--radius-small)", background: "var(--surface)", color: "var(--text)", fontSize: "var(--text-xs)" }}>{notice}</div>}
      {error && <div role="alert" style={{ marginBottom: "1rem", padding: "0.75rem", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "var(--radius-small)", background: "rgba(239,68,68,0.08)", color: "var(--text)", fontSize: "var(--text-sm)" }}>{error}</div>}

      {selected.length > 0 && (
        <div style={{ marginBottom: "1rem", display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "center", padding: "0.6rem 0.8rem", border: "1px solid var(--line)", borderRadius: "var(--radius-small)", background: "var(--surface)", fontSize: "var(--text-xs)" }}>
          <span>{selected.length} selected</span>
          <button type="button" className="btn primary" style={{ padding: "0.4rem 0.7rem", fontSize: "var(--text-xs)" }} onClick={() => void handleBatchApprove()}>Approve selected (max 20)</button>
          <button type="button" className="btn secondary" style={{ padding: "0.4rem 0.7rem", fontSize: "var(--text-xs)" }} onClick={() => setSelected([])}>Clear</button>
        </div>
      )}

      {loading ? (
        <div className="card" style={{ padding: "2rem", color: "var(--muted)" }}>Loading content…</div>
      ) : drafts.length === 0 ? (
        <div className="card" style={{ padding: "2.5rem 1.5rem", textAlign: "center" }}>
          <strong style={{ display: "block", fontSize: "var(--text-md)" }}>Nothing waiting for review</strong>
          <p style={{ margin: "0.4rem 0 0", color: "var(--muted)", fontSize: "var(--text-sm)" }}>Drafts submitted for approval will appear here.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: viewMode === "grid" ? "repeat(auto-fill, minmax(min(100%, 320px), 1fr))" : "1fr" }}>
          {drafts.map((draft) => (
            <div key={draft.id} style={{ position: "relative" }}>
              {activeTab === "pending" && (
                <label style={{ position: "absolute", top: "0.7rem", left: "0.7rem", zIndex: 2, display: "flex", gap: "0.3rem", alignItems: "center", fontSize: "var(--text-xs)", color: "var(--muted)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius-small)", padding: "0.2rem 0.45rem" }}>
                  <input
                    type="checkbox"
                    aria-label={`Select draft ${draft.topic}`}
                    checked={selected.includes(draft.id)}
                    onChange={(e) => setSelected((prev) => (e.target.checked ? [...prev, draft.id] : prev.filter((item) => item !== draft.id)))}
                  />
                  Select
                </label>
              )}
              <ContentDraftCard draft={draft} compact={viewMode === "list"} onApprove={(id) => void handleUpdateStatus(id, "approved")} onReject={(id) => setRejectTarget(id)} onUpdateStatus={(id, status) => void handleUpdateStatus(id, status)} />
            </div>
          ))}
        </div>
      )}

      {rejectTarget && (
        <div role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) { setRejectTarget(null); setRejectNote(""); } }}
          style={{ position: "fixed", inset: 0, zIndex: 100, padding: "1rem", display: "grid", placeItems: "center", background: "rgba(0,0,0,0.72)" }}>
          <div role="dialog" aria-modal="true" aria-labelledby="reject-draft-title" className="card" style={{ width: "min(100%, 480px)", padding: "1.5rem", background: "var(--panel)" }}>
            <h3 id="reject-draft-title" style={{ margin: "0 0 0.5rem", fontSize: "var(--text-lg)" }}>Reject draft</h3>
            <p style={{ margin: "0 0 0.75rem", color: "var(--muted)", fontSize: "var(--text-sm)" }}>Add a revision note so the author knows what to fix. The note is stored on the draft history.</p>
            <label style={fieldLabel}>Revision note<textarea required rows={4} value={rejectNote} onChange={(event) => setRejectNote(event.target.value)} placeholder="What needs to change before this can ship?" style={{ ...fieldStyle, resize: "vertical" }} /></label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
              <button type="button" className="btn secondary" style={{ padding: "0.55rem 0.8rem", fontSize: "var(--text-xs)" }} onClick={() => { setRejectTarget(null); setRejectNote(""); }}>Cancel</button>
              <button type="button" className="btn primary" disabled={!rejectNote.trim()} style={{ padding: "0.55rem 0.8rem", fontSize: "var(--text-xs)" }} onClick={() => { const target = rejectTarget; setRejectTarget(null); const note = rejectNote; setRejectNote(""); void handleUpdateStatus(target, "rejected", note); }}>Reject with note</button>
            </div>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setShowCreateModal(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 100, padding: "1rem", display: "grid", placeItems: "center", background: "rgba(0,0,0,0.72)" }}>
          <div role="dialog" aria-modal="true" aria-labelledby="create-draft-title" className="card" style={{ width: "min(100%, 560px)", maxHeight: "90vh", overflowY: "auto", padding: "1.5rem", background: "var(--panel)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center", marginBottom: "1rem" }}>
              <div><span className="eyebrow">Content workspace</span><h3 id="create-draft-title" style={{ margin: 0, fontSize: "var(--text-lg)" }}>Create draft</h3></div>
              <button type="button" aria-label="Close create draft dialog" onClick={() => setShowCreateModal(false)} style={{ width: 34, height: 34, border: "1px solid var(--line)", borderRadius: "var(--radius-small)", background: "var(--surface)", color: "var(--text)", cursor: "pointer" }}>×</button>
            </div>
            <form onSubmit={handleCreateDraft} style={{ display: "grid", gap: "1rem" }}>
              <label style={fieldLabel}>Campaign topic<input required value={newTopic} onChange={(event) => setNewTopic(event.target.value)} placeholder="Q3 customer success story" style={fieldStyle} /></label>
              <label style={fieldLabel}>Platform<select value={newPlatform} onChange={(event) => setNewPlatform(event.target.value as Platform)} style={fieldStyle}>{["instagram","meta","linkedin","x","tiktok","youtube"].map((platform) => <option key={platform} value={platform}>{platform}</option>)}</select></label>
              <label style={fieldLabel}>Post copy<textarea required rows={6} value={newText} onChange={(event) => setNewText(event.target.value)} placeholder="Write the draft content…" style={{ ...fieldStyle, resize: "vertical" }} /></label>
              <label style={fieldLabel}>Hashtags<input value={newHashtags} onChange={(event) => setNewHashtags(event.target.value)} placeholder="#product, #automation" style={fieldStyle} /></label>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", paddingTop: "0.25rem" }}>
                <button type="button" className="btn secondary" style={{ padding: "0.55rem 0.8rem", fontSize: "var(--text-xs)" }} onClick={() => setShowCreateModal(false)}>Cancel</button>
                <button type="submit" className="btn primary" style={{ padding: "0.55rem 0.8rem", fontSize: "var(--text-xs)" }}>Create & review</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

const fieldLabel: React.CSSProperties = { display: "grid", gap: "0.35rem", color: "var(--muted)", fontSize: "var(--text-xs)", fontWeight: "var(--weight-semibold)" };
const fieldStyle: React.CSSProperties = { width: "100%", minHeight: 40, padding: "0.6rem 0.7rem", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius-small)", color: "var(--text)", font: "inherit", fontSize: "var(--text-sm)" };
