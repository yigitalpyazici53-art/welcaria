"use client";

import { Outfit } from "next/font/google";
import { useCallback, useEffect, useRef, useState } from "react";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const C = {
  teal: "#0d9488",
  tealHover: "#0f766e",
  tealBg: "#f0fdfa",
  tealBorder: "#99f6e4",
  bg: "#ffffff",
  bgAlt: "#f8fafc",
  bgDark: "#0c1427",
  text: "#0f172a",
  textMuted: "#64748b",
  textLight: "#94a3b8",
  border: "#e2e8f0",
  borderStrong: "#cbd5e1",
  amber: "#f59e0b",
  amberBg: "#fffbeb",
  amberBorder: "#fde68a",
  red: "#ef4444",
  redBg: "#fef2f2",
  redBorder: "#fecaca",
  green: "#10b981",
  greenBg: "#f0fdf4",
  greenBorder: "#bbf7d0",
};

const POLL_MS = 4000;

interface ConversationSummary {
  phone: string;
  lastMessagePreview: string;
  lastMessageRole: "user" | "assistant" | null;
  humanHandoff: boolean;
  lastUpdated: number | null;
}

interface Lead {
  name: string | null;
  service: string | null;
  serviceCategory: string | null;
  treatmentArea: string | null;
  language: string | null;
  stage: string | null;
  leadScore: string | null;
  urgency: string | null;
  preferredDate: string | null;
  preferredTime: string | null;
  location: string | null;
  notes: string | null;
  qualificationNotes: string | null;
}

interface ConversationDetail {
  phone: string;
  humanHandoff: boolean;
  lead: Lead;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  messageCount: number;
  lastUpdated: number | null;
}

const STAGE_LABELS: Record<string, string> = {
  collect_treatment_area: "Treatment area",
  collect_qualification: "Qualification",
  collect_datetime: "Date & time",
  collect_name: "Name",
  complete: "Complete",
};

function displayPhone(phone: string): string {
  return phone.startsWith("+") ? phone : `+${phone}`;
}

function initials(phone: string, name: string | null): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-2) || "?";
}

function relativeTime(ts: number | null): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function scoreColor(score: string | null): { bg: string; border: string; color: string } | null {
  switch (score) {
    case "hot":
      return { bg: C.amberBg, border: C.amberBorder, color: "#92400e" };
    case "warm":
      return { bg: "#fff7ed", border: "#fed7aa", color: "#9a3412" };
    case "cold":
      return { bg: C.bgAlt, border: C.border, color: C.textMuted };
    default:
      return null;
  }
}

function PausedBadge() {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        background: C.amberBg,
        border: `1px solid ${C.amberBorder}`,
        borderRadius: "999px",
        padding: "2px 9px",
        fontSize: "0.68rem",
        fontWeight: 700,
        color: "#92400e",
        whiteSpace: "nowrap",
      }}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
        <rect x="6" y="5" width="4" height="14" rx="1" />
        <rect x="14" y="5" width="4" height="14" rx="1" />
      </svg>
      You&apos;re handling this
    </span>
  );
}

export default function InboxPage() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoaded, setListLoaded] = useState(false);

  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [togglingHandoff, setTogglingHandoff] = useState(false);

  // Refs so the polling interval always reads current selection without
  // re-subscribing on every selection change.
  const selectedPhoneRef = useRef<string | null>(null);
  selectedPhoneRef.current = selectedPhone;

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const lastScrollKeyRef = useRef<string>("");

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox/conversations", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/inbox/login";
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setConversations(Array.isArray(data.conversations) ? data.conversations : []);
        setListError(null);
      } else {
        setListError(data.error || "Failed to load conversations");
      }
    } catch {
      setListError("Network error loading conversations");
    } finally {
      setListLoaded(true);
    }
  }, []);

  const fetchDetail = useCallback(async (phone: string, showLoading: boolean) => {
    if (showLoading) setDetailLoading(true);
    try {
      const res = await fetch(`/api/inbox/conversations/${encodeURIComponent(phone)}`, {
        cache: "no-store",
      });
      if (res.status === 401) {
        window.location.href = "/inbox/login";
        return;
      }
      const data = await res.json().catch(() => ({}));
      // Ignore a response that arrived after the user switched conversations.
      if (selectedPhoneRef.current !== phone) return;
      if (data.ok) {
        setDetail(data as ConversationDetail);
      }
    } catch {
      /* keep last-known detail on a transient poll error */
    } finally {
      if (selectedPhoneRef.current === phone) setDetailLoading(false);
    }
  }, []);

  // Initial load + polling for the conversation list and the open conversation.
  useEffect(() => {
    fetchConversations();
    const id = setInterval(() => {
      fetchConversations();
      const p = selectedPhoneRef.current;
      if (p) fetchDetail(p, false);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [fetchConversations, fetchDetail]);

  function selectConversation(phone: string) {
    if (phone === selectedPhone) return;
    setSelectedPhone(phone);
    setDetail(null);
    setReplyText("");
    setSendError(null);
    lastScrollKeyRef.current = "";
    fetchDetail(phone, true);
  }

  // Auto-scroll to newest message when the open conversation's content grows.
  useEffect(() => {
    if (!detail) return;
    const key = `${detail.phone}:${detail.history.length}`;
    if (key !== lastScrollKeyRef.current) {
      lastScrollKeyRef.current = key;
      messagesEndRef.current?.scrollIntoView({ block: "end" });
    }
  }, [detail]);

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    const phone = selectedPhone;
    const body = replyText.trim();
    if (!phone || !body || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/inbox/conversations/${encodeURIComponent(phone)}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (res.status === 401) {
        window.location.href = "/inbox/login";
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setReplyText("");
        await fetchDetail(phone, false);
        fetchConversations();
      } else {
        setSendError(data.error || "The message could not be sent.");
      }
    } catch {
      setSendError("Network error — the message may not have been sent.");
    } finally {
      setSending(false);
    }
  }

  async function toggleHandoff() {
    const phone = selectedPhone;
    if (!phone || !detail || togglingHandoff) return;
    const next = !detail.humanHandoff;
    setTogglingHandoff(true);
    try {
      const res = await fetch(`/api/inbox/conversations/${encodeURIComponent(phone)}/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: next }),
      });
      if (res.status === 401) {
        window.location.href = "/inbox/login";
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        // Reflect immediately, then refresh from source of truth.
        setDetail((d) => (d ? { ...d, humanHandoff: next } : d));
        await fetchDetail(phone, false);
        fetchConversations();
      }
    } catch {
      /* leave state unchanged on failure; next poll reconciles */
    } finally {
      setTogglingHandoff(false);
    }
  }

  const paused = detail?.humanHandoff === true;

  return (
    <div
      className={outfit.className}
      style={{ background: C.bgAlt, color: C.text, height: "100dvh", display: "flex", flexDirection: "column" }}
    >
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }
        .inbox-body { display: flex; flex: 1; min-height: 0; }
        .conv-list { width: 340px; flex-shrink: 0; border-right: 1px solid ${C.border}; background: ${C.bg}; display: flex; flex-direction: column; }
        .conv-detail { flex: 1; min-width: 0; display: flex; flex-direction: column; }
        .conv-row:hover { background: ${C.bgAlt}; }
        .thin-scroll { overflow-y: auto; }
        .thin-scroll::-webkit-scrollbar { width: 8px; }
        .thin-scroll::-webkit-scrollbar-thumb { background: ${C.borderStrong}; border-radius: 999px; }
        @media (max-width: 760px) {
          .conv-list { width: 100%; ${""} }
          .conv-list.hide-mobile { display: none; }
          .conv-detail.hide-mobile { display: none; }
        }
      `}</style>

      {/* Header */}
      <header
        style={{
          background: C.bg,
          borderBottom: `1px solid ${C.border}`,
          padding: "0.85rem 1.5rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.9rem" }}>
          <div>
            <div style={{ fontSize: "1.05rem", fontWeight: 800, color: C.teal, letterSpacing: "-0.035em", lineHeight: 1 }}>
              Welcaria
            </div>
            <div style={{ fontSize: "0.7rem", color: C.textMuted, fontWeight: 500, marginTop: "2px" }}>
              Pilot Inbox
            </div>
          </div>
        </div>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            background: C.greenBg,
            border: `1px solid ${C.greenBorder}`,
            borderRadius: "999px",
            padding: "4px 12px",
            fontSize: "0.72rem",
            fontWeight: 700,
            color: "#065f46",
          }}
        >
          <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: C.green, display: "inline-block" }} />
          Live
        </span>
      </header>

      <div className="inbox-body">
        {/* ── Left: conversation list ─────────────────────────────────────── */}
        <aside className={`conv-list${selectedPhone ? " hide-mobile" : ""}`}>
          <div
            style={{
              padding: "0.9rem 1.25rem",
              borderBottom: `1px solid ${C.border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>Conversations</span>
            <span style={{ fontSize: "0.72rem", color: C.textLight, fontWeight: 600 }}>
              {conversations.length}
            </span>
          </div>

          <div className="thin-scroll" style={{ flex: 1 }}>
            {listError && (
              <div style={{ padding: "1rem 1.25rem", fontSize: "0.8rem", color: "#b91c1c" }}>
                {listError}
              </div>
            )}
            {!listError && listLoaded && conversations.length === 0 && (
              <div style={{ padding: "2rem 1.25rem", fontSize: "0.825rem", color: C.textLight, textAlign: "center", lineHeight: 1.5 }}>
                No conversations in the last 24 hours yet.
              </div>
            )}
            {!listLoaded && (
              <div style={{ padding: "2rem 1.25rem", fontSize: "0.825rem", color: C.textLight, textAlign: "center" }}>
                Loading…
              </div>
            )}

            {conversations.map((c) => {
              const active = c.phone === selectedPhone;
              return (
                <button
                  key={c.phone}
                  className="conv-row"
                  onClick={() => selectConversation(c.phone)}
                  style={{
                    display: "flex",
                    gap: "0.7rem",
                    width: "100%",
                    textAlign: "left",
                    padding: "0.8rem 1.25rem",
                    background: active ? C.tealBg : "transparent",
                    border: "none",
                    borderLeft: active ? `3px solid ${C.teal}` : "3px solid transparent",
                    borderBottom: `1px solid ${C.border}`,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  <div
                    style={{
                      width: "38px",
                      height: "38px",
                      borderRadius: "50%",
                      background: C.tealBg,
                      border: `1.5px solid ${C.tealBorder}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      fontSize: "0.78rem",
                      color: C.teal,
                      flexShrink: 0,
                    }}
                  >
                    {initials(c.phone, null)}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
                      <span style={{ fontWeight: 600, fontSize: "0.85rem", color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {displayPhone(c.phone)}
                      </span>
                      <span style={{ fontSize: "0.68rem", color: C.textLight, flexShrink: 0 }}>
                        {relativeTime(c.lastUpdated)}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: "0.785rem",
                        color: C.textMuted,
                        marginTop: "3px",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {c.lastMessageRole === "assistant" && (
                        <span style={{ color: C.textLight, fontWeight: 600 }}>You: </span>
                      )}
                      {c.lastMessagePreview || <span style={{ color: C.textLight }}>No messages</span>}
                    </div>
                    {c.humanHandoff && (
                      <div style={{ marginTop: "5px" }}>
                        <PausedBadge />
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* ── Right: selected conversation ────────────────────────────────── */}
        <section className={`conv-detail${selectedPhone ? "" : " hide-mobile"}`}>
          {!selectedPhone ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: C.textLight,
                gap: "0.75rem",
                padding: "2rem",
                textAlign: "center",
              }}
            >
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={C.borderStrong} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <div style={{ fontSize: "0.9rem", fontWeight: 500 }}>Select a conversation to view the thread</div>
            </div>
          ) : (
            <>
              {/* Conversation header + lead info */}
              <div style={{ borderBottom: `1px solid ${C.border}`, background: C.bg, padding: "0.85rem 1.5rem", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", minWidth: 0 }}>
                    <div
                      style={{
                        width: "40px",
                        height: "40px",
                        borderRadius: "50%",
                        background: C.tealBg,
                        border: `1.5px solid ${C.tealBorder}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 700,
                        fontSize: "0.85rem",
                        color: C.teal,
                        flexShrink: 0,
                      }}
                    >
                      {initials(selectedPhone, detail?.lead.name ?? null)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: "0.95rem", color: C.text, lineHeight: 1.2 }}>
                        {detail?.lead.name || displayPhone(selectedPhone)}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: C.textMuted, marginTop: "1px" }}>
                        {detail?.lead.name ? displayPhone(selectedPhone) : "Unknown patient"}
                      </div>
                    </div>
                  </div>

                  {/* Pause / resume toggle */}
                  <button
                    onClick={toggleHandoff}
                    disabled={!detail || togglingHandoff}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "0.5rem 0.9rem",
                      fontSize: "0.8rem",
                      fontWeight: 700,
                      fontFamily: "inherit",
                      cursor: !detail || togglingHandoff ? "not-allowed" : "pointer",
                      borderRadius: "999px",
                      border: `1px solid ${paused ? C.greenBorder : C.amberBorder}`,
                      background: paused ? C.greenBg : C.amberBg,
                      color: paused ? "#065f46" : "#92400e",
                      opacity: !detail || togglingHandoff ? 0.6 : 1,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {paused ? (
                      <>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                        Resume bot
                      </>
                    ) : (
                      <>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <rect x="6" y="5" width="4" height="14" rx="1" />
                          <rect x="14" y="5" width="4" height="14" rx="1" />
                        </svg>
                        Pause bot &amp; take over
                      </>
                    )}
                  </button>
                </div>

                {/* Lead chips */}
                {detail && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.75rem" }}>
                    {paused && <PausedBadge />}
                    <LeadChip label="Service" value={detail.lead.service || detail.lead.treatmentArea} />
                    <LeadChip label="Stage" value={detail.lead.stage ? STAGE_LABELS[detail.lead.stage] ?? detail.lead.stage : null} />
                    <LeadChip label="Language" value={detail.lead.language} upper />
                    {detail.lead.leadScore && <ScoreChip score={detail.lead.leadScore} />}
                    <LeadChip label="Preferred" value={[detail.lead.preferredDate, detail.lead.preferredTime].filter(Boolean).join(" ") || null} />
                  </div>
                )}
              </div>

              {/* Messages */}
              <div className="thin-scroll" style={{ flex: 1, padding: "1.25rem 1.5rem", background: C.bgAlt }}>
                {detailLoading && !detail && (
                  <div style={{ textAlign: "center", color: C.textLight, fontSize: "0.85rem", marginTop: "1rem" }}>
                    Loading conversation…
                  </div>
                )}
                {detail && detail.history.length === 0 && (
                  <div style={{ textAlign: "center", color: C.textLight, fontSize: "0.85rem", marginTop: "1rem" }}>
                    No messages in this conversation.
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem", maxWidth: "720px", margin: "0 auto" }}>
                  {detail?.history.map((m, i) => {
                    const isUser = m.role === "user";
                    return (
                      <div
                        key={i}
                        style={{
                          alignSelf: isUser ? "flex-start" : "flex-end",
                          maxWidth: "78%",
                          background: isUser ? C.bg : C.teal,
                          color: isUser ? C.text : "#ffffff",
                          border: isUser ? `1px solid ${C.border}` : "none",
                          borderRadius: isUser ? "4px 14px 14px 14px" : "14px 4px 14px 14px",
                          padding: "0.6rem 0.85rem",
                          fontSize: "0.875rem",
                          lineHeight: 1.5,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          boxShadow: "0 1px 2px rgba(15,23,42,0.05)",
                        }}
                      >
                        <div style={{ fontSize: "0.64rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", opacity: 0.65, marginBottom: "3px" }}>
                          {isUser ? "Patient" : "Clinic"}
                        </div>
                        {m.content}
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              {/* Reply box */}
              <div style={{ borderTop: `1px solid ${C.border}`, background: C.bg, padding: "0.9rem 1.5rem", flexShrink: 0 }}>
                {sendError && (
                  <div
                    style={{
                      marginBottom: "0.7rem",
                      background: C.redBg,
                      border: `1px solid ${C.redBorder}`,
                      borderRadius: "10px",
                      padding: "0.6rem 0.85rem",
                      fontSize: "0.8rem",
                      color: "#b91c1c",
                      lineHeight: 1.45,
                      display: "flex",
                      gap: "0.5rem",
                    }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: "1px" }}>
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span>{sendError}</span>
                  </div>
                )}
                <form onSubmit={sendReply} style={{ display: "flex", gap: "0.6rem", alignItems: "flex-end" }}>
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendReply(e);
                      }
                    }}
                    placeholder="Type a reply…  (Enter to send, Shift+Enter for a new line)"
                    rows={1}
                    style={{
                      flex: 1,
                      resize: "none",
                      maxHeight: "140px",
                      padding: "0.65rem 0.85rem",
                      fontSize: "0.9rem",
                      fontFamily: "inherit",
                      lineHeight: 1.45,
                      color: C.text,
                      background: C.bg,
                      border: `1px solid ${C.border}`,
                      borderRadius: "12px",
                      outline: "none",
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = C.teal)}
                    onBlur={(e) => (e.currentTarget.style.borderColor = C.border)}
                  />
                  <button
                    type="submit"
                    disabled={sending || !replyText.trim()}
                    style={{
                      padding: "0.65rem 1.25rem",
                      fontSize: "0.875rem",
                      fontWeight: 700,
                      fontFamily: "inherit",
                      color: "#ffffff",
                      background: sending || !replyText.trim() ? C.textLight : C.teal,
                      border: "none",
                      borderRadius: "12px",
                      cursor: sending || !replyText.trim() ? "not-allowed" : "pointer",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    {sending ? "Sending…" : "Send"}
                  </button>
                </form>
                <div style={{ fontSize: "0.68rem", color: C.textLight, marginTop: "0.5rem", lineHeight: 1.4 }}>
                  Replies send only within WhatsApp&apos;s 24-hour window and pass through the compliance gate.
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function LeadChip({ label, value, upper }: { label: string; value: string | null; upper?: boolean }) {
  if (!value) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        background: C.bgAlt,
        border: `1px solid ${C.border}`,
        borderRadius: "999px",
        padding: "2px 10px",
        fontSize: "0.72rem",
        color: C.textMuted,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ fontWeight: 700, color: C.textLight, textTransform: "uppercase", fontSize: "0.62rem", letterSpacing: "0.04em" }}>
        {label}
      </span>
      <span style={{ fontWeight: 600, color: C.text, textTransform: upper ? "uppercase" : "none" }}>{value}</span>
    </span>
  );
}

function ScoreChip({ score }: { score: string }) {
  const c = scoreColor(score);
  if (!c) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: "999px",
        padding: "2px 10px",
        fontSize: "0.72rem",
        fontWeight: 700,
        color: c.color,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: c.color, display: "inline-block" }} />
      {score}
    </span>
  );
}
