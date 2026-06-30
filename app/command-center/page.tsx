import { Outfit } from "next/font/google";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "LeadAura Command Center — Aurea Aesthetic Clinic",
  description: "WhatsApp lead response system for premium clinics.",
};

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
  green: "#10b981",
  greenBg: "#f0fdf4",
  greenBorder: "#bbf7d0",
  warm: "#f97316",
  warmBg: "#fff7ed",
  warmBorder: "#fed7aa",
};

const kpiCards = [
  {
    label: "Today's Inquiries",
    value: "12",
    sub: "Since midnight",
    accent: C.teal,
    accentBg: C.tealBg,
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    label: "Qualified Leads",
    value: "9",
    sub: "75% qualification rate",
    accent: C.teal,
    accentBg: C.tealBg,
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
  },
  {
    label: "Hot Leads",
    value: "4",
    sub: "Require fast follow-up",
    accent: C.amber,
    accentBg: C.amberBg,
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ),
  },
  {
    label: "After-Hours Leads",
    value: "3",
    sub: "Captured while clinic was closed",
    accent: C.warm,
    accentBg: C.warmBg,
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
];

type LeadScore = "HOT" | "WARM";
type LeadStatus = "Team alerted" | "Follow-up needed" | "Waiting for details";

const hotLeads: {
  patient: string;
  treatment: string;
  preferredTime: string;
  source: string;
  score: LeadScore;
  status: LeadStatus;
}[] = [
  {
    patient: "Zeynep K.",
    treatment: "Full body laser",
    preferredTime: "Saturday afternoon",
    source: "WhatsApp",
    score: "HOT",
    status: "Team alerted",
  },
  {
    patient: "Sarah M.",
    treatment: "Hair transplant consultation",
    preferredTime: "Next week",
    source: "WhatsApp",
    score: "HOT",
    status: "Follow-up needed",
  },
  {
    patient: "Omar A.",
    treatment: "Dental veneers",
    preferredTime: "Friday morning",
    source: "WhatsApp",
    score: "WARM",
    status: "Waiting for details",
  },
  {
    patient: "Lina R.",
    treatment: "Skin treatment",
    preferredTime: "Tomorrow afternoon",
    source: "WhatsApp",
    score: "HOT",
    status: "Team alerted",
  },
];

const systemModules = [
  "WhatsApp response",
  "Lead qualification",
  "Hot-lead alerts",
  "Lead logging",
  "Daily owner summary",
];

function ScorePill({ score }: { score: LeadScore }) {
  const isHot = score === "HOT";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "2px 10px",
        borderRadius: "999px",
        fontSize: "0.72rem",
        fontWeight: 700,
        letterSpacing: "0.05em",
        background: isHot ? C.amberBg : C.warmBg,
        color: isHot ? "#92400e" : "#9a3412",
        border: `1px solid ${isHot ? C.amberBorder : C.warmBorder}`,
      }}
    >
      <span
        style={{
          width: "5px",
          height: "5px",
          borderRadius: "50%",
          background: isHot ? C.amber : C.warm,
          flexShrink: 0,
        }}
      />
      {score}
    </span>
  );
}

function StatusBadge({ status }: { status: LeadStatus }) {
  const isAlerted = status === "Team alerted";
  const isFollowUp = status === "Follow-up needed";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: "999px",
        fontSize: "0.72rem",
        fontWeight: 600,
        background: isAlerted ? C.greenBg : isFollowUp ? C.amberBg : C.bgAlt,
        color: isAlerted ? "#065f46" : isFollowUp ? "#92400e" : C.textMuted,
        border: `1px solid ${isAlerted ? C.greenBorder : isFollowUp ? C.amberBorder : C.border}`,
        whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  );
}

function ActiveDot() {
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <span
        style={{
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          background: C.green,
          display: "inline-block",
          flexShrink: 0,
        }}
      />
    </span>
  );
}

export default function CommandCenter() {
  return (
    <div
      className={outfit.className}
      style={{ background: C.bgAlt, color: C.text, minHeight: "100dvh" }}
    >
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }

        .cc-container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 2rem;
        }

        .kpi-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 1rem;
        }
        @media (max-width: 900px) {
          .kpi-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 480px) {
          .kpi-grid { grid-template-columns: 1fr; }
        }

        .main-grid {
          display: grid;
          grid-template-columns: 1fr 340px;
          gap: 1.25rem;
          align-items: start;
        }
        @media (max-width: 1000px) {
          .main-grid { grid-template-columns: 1fr; }
        }

        .bottom-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1.25rem;
          align-items: start;
        }
        @media (max-width: 760px) {
          .bottom-grid { grid-template-columns: 1fr; }
        }

        .leads-table { width: 100%; border-collapse: collapse; }
        .leads-table th {
          text-align: left;
          font-size: 0.72rem;
          font-weight: 600;
          color: ${C.textLight};
          text-transform: uppercase;
          letter-spacing: 0.06em;
          padding: 0.6rem 1rem;
          border-bottom: 1px solid ${C.border};
          white-space: nowrap;
        }
        .leads-table td {
          padding: 0.875rem 1rem;
          font-size: 0.875rem;
          border-bottom: 1px solid ${C.border};
          vertical-align: middle;
        }
        .leads-table tr:last-child td { border-bottom: none; }
        .leads-table tr:hover td { background: ${C.bgAlt}; }

        .table-scroll { overflow-x: auto; }

        @media (max-width: 640px) {
          .cc-container { padding: 0 1rem; }
          .leads-table th, .leads-table td { padding: 0.65rem 0.65rem; font-size: 0.8rem; }
        }
      `}</style>

      {/* Header */}
      <header
        style={{
          background: C.bg,
          borderBottom: `1px solid ${C.border}`,
          position: "sticky",
          top: 0,
          zIndex: 50,
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}
      >
        <div
          className="cc-container"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "0.75rem",
            padding: "1.1rem 2rem",
          }}
        >
          {/* Left: branding + clinic */}
          <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", flexWrap: "wrap" }}>
            <div>
              <div
                style={{
                  fontSize: "1.15rem",
                  fontWeight: 800,
                  color: C.teal,
                  letterSpacing: "-0.035em",
                  lineHeight: 1,
                }}
              >
                LeadAura
              </div>
              <div
                style={{
                  fontSize: "0.72rem",
                  color: C.textMuted,
                  fontWeight: 500,
                  letterSpacing: "0.01em",
                  marginTop: "2px",
                }}
              >
                Command Center
              </div>
            </div>
            <div
              style={{
                width: "1px",
                height: "28px",
                background: C.border,
              }}
            />
            <div>
              <div style={{ fontWeight: 700, fontSize: "0.95rem", color: C.text, lineHeight: 1.2 }}>
                Aurea Aesthetic Clinic
              </div>
              <div style={{ fontSize: "0.72rem", color: C.textMuted, marginTop: "2px" }}>
                WhatsApp lead response &middot; Hot-lead alerts &middot; Daily owner summary
              </div>
            </div>
          </div>

          {/* Right: status pill */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: C.greenBg,
              border: `1px solid ${C.greenBorder}`,
              borderRadius: "999px",
              padding: "5px 14px",
              fontSize: "0.78rem",
              fontWeight: 700,
              color: "#065f46",
              whiteSpace: "nowrap",
            }}
          >
            <span
              style={{
                width: "7px",
                height: "7px",
                borderRadius: "50%",
                background: C.green,
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            Live pilot active
          </div>
        </div>
      </header>

      {/* Page body */}
      <main style={{ padding: "2rem 0 4rem" }}>
        <div className="cc-container" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

          {/* KPI Cards */}
          <div className="kpi-grid">
            {kpiCards.map((card) => (
              <div
                key={card.label}
                style={{
                  background: C.bg,
                  border: `1px solid ${C.border}`,
                  borderRadius: "16px",
                  padding: "1.5rem 1.5rem 1.25rem",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.75rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: "0.8rem", fontWeight: 600, color: C.textMuted, letterSpacing: "0.01em" }}>
                    {card.label}
                  </div>
                  <div
                    style={{
                      width: "34px",
                      height: "34px",
                      borderRadius: "10px",
                      background: card.accentBg,
                      color: card.accent,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {card.icon}
                  </div>
                </div>
                <div>
                  <div
                    style={{
                      fontSize: "2.25rem",
                      fontWeight: 800,
                      color: C.text,
                      letterSpacing: "-0.04em",
                      lineHeight: 1,
                    }}
                  >
                    {card.value}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: C.textLight, marginTop: "4px" }}>
                    {card.sub}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Hot Leads + Detail Card */}
          <div className="main-grid">
            {/* Hot leads table */}
            <div
              style={{
                background: C.bg,
                border: `1px solid ${C.border}`,
                borderRadius: "16px",
                boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "1.25rem 1.5rem 1rem",
                  borderBottom: `1px solid ${C.border}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.975rem", color: C.text }}>Recent Hot Leads</div>
                  <div style={{ fontSize: "0.78rem", color: C.textMuted, marginTop: "2px" }}>Today&apos;s most qualified WhatsApp inquiries</div>
                </div>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    background: C.amberBg,
                    border: `1px solid ${C.amberBorder}`,
                    borderRadius: "999px",
                    padding: "3px 10px",
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    color: "#92400e",
                  }}
                >
                  <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: C.amber, display: "inline-block" }} />
                  4 hot leads today
                </span>
              </div>
              <div className="table-scroll">
                <table className="leads-table">
                  <thead>
                    <tr>
                      <th>Patient</th>
                      <th>Treatment</th>
                      <th>Preferred time</th>
                      <th>Source</th>
                      <th>Score</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hotLeads.map((lead) => (
                      <tr key={lead.patient}>
                        <td style={{ fontWeight: 600, color: C.text }}>{lead.patient}</td>
                        <td style={{ color: C.textMuted }}>{lead.treatment}</td>
                        <td style={{ color: C.textMuted, whiteSpace: "nowrap" }}>{lead.preferredTime}</td>
                        <td>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              fontSize: "0.78rem",
                              color: C.textMuted,
                              fontWeight: 500,
                            }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="#25d366" style={{ flexShrink: 0 }}>
                              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.126 1.533 5.857L.054 23.454a.5.5 0 00.492.6h.001l5.817-1.524A11.95 11.95 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22a9.95 9.95 0 01-5.07-1.382l-.36-.214-3.742.981.998-3.648-.235-.374A9.95 9.95 0 012 12C2 6.478 6.478 2 12 2s10 4.478 10 10-4.478 10-10 10z" />
                            </svg>
                            {lead.source}
                          </span>
                        </td>
                        <td>
                          <ScorePill score={lead.score} />
                        </td>
                        <td>
                          <StatusBadge status={lead.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Lead detail preview card */}
            <div
              style={{
                background: C.bg,
                border: `1px solid ${C.border}`,
                borderRadius: "16px",
                boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "1.25rem 1.5rem 1rem",
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: "0.975rem", color: C.text }}>Lead Detail</div>
                <div style={{ fontSize: "0.78rem", color: C.textMuted, marginTop: "2px" }}>Selected lead preview</div>
              </div>

              <div style={{ padding: "1.25rem 1.5rem" }}>
                {/* Patient name row */}
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.25rem" }}>
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
                      fontWeight: 800,
                      fontSize: "0.9rem",
                      color: C.teal,
                      flexShrink: 0,
                    }}
                  >
                    ZK
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "0.95rem", color: C.text }}>Zeynep K.</div>
                    <div style={{ fontSize: "0.78rem", color: C.textMuted }}>+44 7700 900123</div>
                  </div>
                  <ScorePill score="HOT" />
                </div>

                {/* Detail rows */}
                <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                  {([
                    ["Treatment", "Full body laser"],
                    ["First time", "Yes"],
                    ["Price asked", "Yes"],
                    ["Preferred time", "Saturday afternoon"],
                  ] as [string, string][]).map(([k, v]) => (
                    <div
                      key={k}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "0.75rem",
                        padding: "0.55rem 0",
                        borderBottom: `1px solid ${C.border}`,
                        fontSize: "0.875rem",
                      }}
                    >
                      <span style={{ color: C.textMuted, flexShrink: 0 }}>{k}</span>
                      <span style={{ fontWeight: 600, color: C.text, textAlign: "right" }}>{v}</span>
                    </div>
                  ))}
                </div>

                {/* Recommended action */}
                <div
                  style={{
                    marginTop: "1.25rem",
                    background: C.amberBg,
                    border: `1px solid ${C.amberBorder}`,
                    borderRadius: "12px",
                    padding: "0.875rem 1rem",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "0.6rem",
                  }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={C.amber}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ flexShrink: 0, marginTop: "1px" }}
                  >
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                  </svg>
                  <div>
                    <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "2px" }}>
                      Recommended Action
                    </div>
                    <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#78350f" }}>
                      Follow up ASAP
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* System Status + Daily Summary */}
          <div className="bottom-grid">
            {/* System Status */}
            <div
              style={{
                background: C.bg,
                border: `1px solid ${C.border}`,
                borderRadius: "16px",
                boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "1.25rem 1.5rem 1rem",
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: "0.975rem", color: C.text }}>System Status</div>
                <div style={{ fontSize: "0.78rem", color: C.textMuted, marginTop: "2px" }}>Active modules — all systems running</div>
              </div>
              <div style={{ padding: "0.5rem 0" }}>
                {systemModules.map((mod) => (
                  <div
                    key={mod}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "0.75rem 1.5rem",
                      borderBottom: `1px solid ${C.border}`,
                    }}
                  >
                    <span style={{ fontSize: "0.875rem", fontWeight: 500, color: C.text }}>{mod}</span>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "5px",
                        background: C.greenBg,
                        border: `1px solid ${C.greenBorder}`,
                        borderRadius: "999px",
                        padding: "2px 10px",
                        fontSize: "0.7rem",
                        fontWeight: 700,
                        color: "#065f46",
                      }}
                    >
                      <ActiveDot />
                      Active
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Daily Summary Preview */}
            <div
              style={{
                background: C.bg,
                border: `1px solid ${C.border}`,
                borderRadius: "16px",
                boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "1.25rem 1.5rem 1rem",
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: "0.975rem", color: C.text }}>Daily Summary Preview</div>
                <div style={{ fontSize: "0.78rem", color: C.textMuted, marginTop: "2px" }}>Sent to clinic owner every morning</div>
              </div>
              <div style={{ padding: "1.25rem 1.5rem" }}>
                {/* Email-style preview */}
                <div
                  style={{
                    background: C.bgAlt,
                    border: `1px solid ${C.border}`,
                    borderRadius: "12px",
                    overflow: "hidden",
                  }}
                >
                  {/* Email header */}
                  <div
                    style={{
                      background: C.bgDark,
                      padding: "1rem 1.25rem",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.7rem",
                        fontWeight: 700,
                        color: C.teal,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        marginBottom: "4px",
                      }}
                    >
                      LeadAura
                    </div>
                    <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#f1f5f9", lineHeight: 1.3 }}>
                      Daily Lead Summary
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "#475569", marginTop: "2px" }}>
                      Aurea Aesthetic Clinic
                    </div>
                  </div>

                  {/* Email body */}
                  <div style={{ padding: "1rem 1.25rem" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1rem" }}>
                      {([
                        ["Total inquiries", "12"],
                        ["Qualified leads", "9"],
                        ["Hot leads", "4"],
                        ["After-hours leads", "3"],
                      ] as [string, string][]).map(([k, v]) => (
                        <div
                          key={k}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: "0.85rem",
                            padding: "0.4rem 0",
                            borderBottom: `1px solid ${C.border}`,
                          }}
                        >
                          <span style={{ color: C.textMuted }}>{k}</span>
                          <span style={{ fontWeight: 700, color: C.text }}>{v}</span>
                        </div>
                      ))}
                    </div>
                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: C.textMuted,
                        lineHeight: 1.55,
                        fontStyle: "italic",
                        borderTop: `1px solid ${C.border}`,
                        paddingTop: "0.75rem",
                      }}
                    >
                      Note: Appointment requests are not confirmed bookings.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Compliance / Trust note */}
          <div
            style={{
              background: C.bg,
              border: `1px solid ${C.border}`,
              borderRadius: "12px",
              padding: "1rem 1.5rem",
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke={C.textLight}
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0 }}
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <p style={{ fontSize: "0.78rem", color: C.textMuted, lineHeight: 1.55, margin: 0 }}>
              LeadAura does not provide medical advice, does not invent exact pricing, and does not confirm bookings.
              Your team remains responsible for final patient follow-up.
            </p>
          </div>

        </div>
      </main>
    </div>
  );
}
