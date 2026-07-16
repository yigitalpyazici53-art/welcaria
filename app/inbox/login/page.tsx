"use client";

import { Outfit } from "next/font/google";
import { useState } from "react";

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
  text: "#0f172a",
  textMuted: "#64748b",
  textLight: "#94a3b8",
  border: "#e2e8f0",
  red: "#ef4444",
  redBg: "#fef2f2",
  redBorder: "#fecaca",
};

export default function InboxLogin() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/inbox/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        // Full navigation so middleware re-evaluates with the fresh cookie.
        window.location.href = "/inbox";
        return;
      }
      setError(
        res.status === 401
          ? "Incorrect password. Please try again."
          : data.error || "Login failed. Please try again."
      );
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className={outfit.className}
      style={{
        background: C.bgAlt,
        color: C.text,
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "400px",
          background: C.bg,
          border: `1px solid ${C.border}`,
          borderRadius: "18px",
          boxShadow: "0 4px 24px rgba(15,23,42,0.06)",
          padding: "2.25rem 2rem",
        }}
      >
        {/* Branding */}
        <div style={{ textAlign: "center", marginBottom: "1.75rem" }}>
          <div
            style={{
              fontSize: "1.35rem",
              fontWeight: 800,
              color: C.teal,
              letterSpacing: "-0.035em",
              lineHeight: 1,
            }}
          >
            Welcaria
          </div>
          <div
            style={{
              fontSize: "0.8rem",
              color: C.textMuted,
              fontWeight: 500,
              marginTop: "6px",
            }}
          >
            Pilot Inbox
          </div>
        </div>

        <form onSubmit={onSubmit}>
          <label
            htmlFor="inbox-password"
            style={{
              display: "block",
              fontSize: "0.8rem",
              fontWeight: 600,
              color: C.text,
              marginBottom: "0.5rem",
            }}
          >
            Password
          </label>
          <input
            id="inbox-password"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter inbox password"
            style={{
              width: "100%",
              padding: "0.7rem 0.85rem",
              fontSize: "0.925rem",
              fontFamily: "inherit",
              color: C.text,
              background: C.bg,
              border: `1px solid ${C.border}`,
              borderRadius: "10px",
              outline: "none",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = C.teal)}
            onBlur={(e) => (e.currentTarget.style.borderColor = C.border)}
          />

          {error && (
            <div
              style={{
                marginTop: "0.85rem",
                background: C.redBg,
                border: `1px solid ${C.redBorder}`,
                borderRadius: "10px",
                padding: "0.65rem 0.85rem",
                fontSize: "0.825rem",
                color: "#b91c1c",
                lineHeight: 1.45,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !password.trim()}
            style={{
              width: "100%",
              marginTop: "1.25rem",
              padding: "0.75rem",
              fontSize: "0.925rem",
              fontWeight: 700,
              fontFamily: "inherit",
              color: "#ffffff",
              background: submitting || !password.trim() ? C.textLight : C.teal,
              border: "none",
              borderRadius: "10px",
              cursor: submitting || !password.trim() ? "not-allowed" : "pointer",
              transition: "background 0.15s ease",
            }}
            onMouseEnter={(e) => {
              if (!submitting && password.trim()) e.currentTarget.style.background = C.tealHover;
            }}
            onMouseLeave={(e) => {
              if (!submitting && password.trim()) e.currentTarget.style.background = C.teal;
            }}
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p
          style={{
            marginTop: "1.5rem",
            fontSize: "0.72rem",
            color: C.textLight,
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          Authorized clinic staff only. Sessions expire after 12 hours.
        </p>
      </div>
    </div>
  );
}
