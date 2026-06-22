import { Outfit } from "next/font/google";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const CONTACT_URL =
  "mailto:yigitalpyazici53@gmail.com?subject=RandevuFlow%20Pilot%20Application";

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
  border: "#e2e8f0",
  amber: "#f59e0b",
  red: "#ef4444",
};

function CheckIcon({ white }: { white?: boolean }) {
  const fill = white ? "rgba(13,148,136,0.28)" : C.tealBg;
  const stroke = white ? "#5eead4" : C.teal;
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 17 17"
      fill="none"
      style={{ flexShrink: 0, marginTop: "1px" }}
    >
      <circle cx="8.5" cy="8.5" r="8.5" fill={fill} />
      <path
        d="M5.5 8.5L7.5 10.5L11.5 6.5"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckList({ items, white }: { items: string[]; white?: boolean }) {
  return (
    <div style={{ margin: "1.5rem 0" }}>
      {items.map((item) => (
        <div
          key={item}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "0.6rem",
            padding: "0.35rem 0",
            fontSize: "0.9rem",
            color: white ? "#cbd5e1" : C.text,
          }}
        >
          <CheckIcon white={white} />
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

const pilotFeatures = [
  "AI message flow setup",
  "WhatsApp inquiry handling demo",
  "Hot lead notification format",
  "Basic lead logging",
  "7-day pilot support",
];

const standardFeatures = [
  "Custom clinic flow",
  "Service/treatment qualification",
  "Lead scoring",
  "Owner/team notifications",
  "Basic reporting",
];

const clinicFeatures = [
  "Custom workflows",
  "Multi-location routing",
  "Advanced CRM/Sheets setup",
  "Priority support",
];

const faqs = [
  {
    q: "Does it replace my staff?",
    a: "No. It helps your team respond faster and qualify inquiries before human follow-up.",
  },
  {
    q: "Does it give medical advice?",
    a: "No. It only handles basic inquiry qualification and routes sensitive questions to the clinic team.",
  },
  {
    q: "Does it invent prices?",
    a: "No. It avoids exact pricing unless the clinic provides approved pricing rules.",
  },
  {
    q: "Can it work with Instagram and WhatsApp?",
    a: "The pilot is designed around Instagram/WhatsApp inquiry workflows. Final setup depends on the clinic's current tools and approved integrations.",
  },
  {
    q: "How fast can we start?",
    a: "A pilot flow can usually be prepared in 1–2 days after the clinic provides service details and message examples.",
  },
];

const demoMessages = [
  {
    who: "customer",
    name: "Zeynep",
    text: "Hi, how much is full-body laser hair removal?",
  },
  {
    who: "assistant",
    name: "RandevuFlow",
    text: "Hi! I can help. Full-body laser pricing can vary depending on the package, sessions, and current offers. Have you had laser hair removal before?",
  },
  {
    who: "customer",
    name: "Zeynep",
    text: "No, it would be my first time. I can come on Saturday.",
  },
  {
    who: "assistant",
    name: "RandevuFlow",
    text: "Great. I can create an appointment request for Saturday. May I have your name and phone number?",
  },
  { who: "customer", name: "Zeynep", text: "Zeynep, +44 7700 900123" },
  {
    who: "assistant",
    name: "RandevuFlow",
    text: "Thank you, Zeynep! I've noted your appointment request for Saturday. Our team will be in touch shortly to confirm the details.",
  },
];

const collectsItems = [
  { label: "Service", value: "Laser hair removal" },
  { label: "Treatment area", value: "Full body" },
  { label: "First time", value: "Yes" },
  { label: "Preferred time", value: "Saturday" },
  { label: "Price inquiry", value: "Yes" },
  { label: "Lead score", value: "HOT" },
];

const notifRows: [string, string, boolean?][] = [
  ["Name", "Zeynep"],
  ["Phone", "+44 7700 900123"],
  ["Service", "Laser hair removal"],
  ["Area", "Full body"],
  ["First time", "Yes"],
  ["Time", "Saturday"],
  ["Asked price", "Yes"],
  ["Lead score", "HOT", true],
  ["Recommendation", "Fast follow-up recommended", true],
];

export default function EnPage() {
  return (
    <div
      className={outfit.className}
      style={{ background: C.bg, color: C.text, minHeight: "100dvh" }}
    >
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }

        .hero-grid {
          display: grid;
          grid-template-columns: 1.1fr 0.9fr;
          gap: 3.5rem;
          align-items: center;
          max-width: 1180px;
          margin: 0 auto;
          padding: 5rem 2.5rem 4.5rem;
        }
        @media (max-width: 900px) {
          .hero-grid { grid-template-columns: 1fr; gap: 0; padding: 3.5rem 1.5rem 3rem; }
          .hero-right { margin-top: 2rem; }
          .hero-chat-card { display: none; }
        }

        .how-it-works-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1.5rem;
          margin-top: 2.5rem;
        }
        @media (max-width: 640px) {
          .how-it-works-grid { grid-template-columns: 1fr; }
        }

        .collects-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1rem;
          margin-top: 2rem;
        }
        @media (max-width: 640px) {
          .collects-grid { grid-template-columns: 1fr 1fr; }
        }

        .pricing-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1.5rem;
          margin-top: 2.5rem;
        }
        @media (max-width: 900px) {
          .pricing-grid { grid-template-columns: 1fr; max-width: 460px; margin-left: auto; margin-right: auto; }
        }

        .btn-primary {
          background: ${C.teal};
          color: #fff;
          border: none;
          border-radius: 10px;
          padding: 0.95rem 2.25rem;
          font-size: 1rem;
          font-weight: 700;
          cursor: pointer;
          text-decoration: none;
          display: inline-block;
          transition: background 0.2s, transform 0.15s;
          white-space: nowrap;
          line-height: 1;
        }
        .btn-primary:hover { background: ${C.tealHover}; transform: translateY(-1px); }
        .btn-primary:active { transform: translateY(0); }

        .btn-primary-lg {
          background: ${C.teal};
          color: #fff;
          border: none;
          border-radius: 10px;
          padding: 1rem 2.5rem;
          font-size: 1.05rem;
          font-weight: 700;
          cursor: pointer;
          text-decoration: none;
          display: inline-block;
          transition: background 0.2s, transform 0.15s;
          white-space: nowrap;
          line-height: 1;
        }
        .btn-primary-lg:hover { background: ${C.tealHover}; transform: translateY(-1px); }
        .btn-primary-lg:active { transform: translateY(0); }

        .btn-ghost {
          background: transparent;
          color: ${C.teal};
          border: 1.5px solid ${C.teal};
          border-radius: 10px;
          padding: 0.93rem 2.25rem;
          font-size: 1rem;
          font-weight: 700;
          cursor: pointer;
          text-decoration: none;
          display: inline-block;
          transition: background 0.2s, transform 0.15s;
          white-space: nowrap;
          line-height: 1;
        }
        .btn-ghost:hover { background: ${C.tealBg}; transform: translateY(-1px); }
        .btn-ghost:active { transform: translateY(0); }

        .btn-card-cta {
          background: ${C.teal};
          color: #fff;
          border: none;
          border-radius: 10px;
          padding: 0.875rem 1.75rem;
          font-size: 0.95rem;
          font-weight: 700;
          cursor: pointer;
          text-decoration: none;
          display: block;
          width: 100%;
          text-align: center;
          transition: background 0.2s, transform 0.15s;
          white-space: nowrap;
        }
        .btn-card-cta:hover { background: ${C.tealHover}; transform: translateY(-1px); }
        .btn-card-cta:active { transform: translateY(0); }

        .btn-outline-cta {
          background: transparent;
          color: ${C.teal};
          border: 1.5px solid ${C.teal};
          border-radius: 10px;
          padding: 0.875rem 1.75rem;
          font-size: 0.95rem;
          font-weight: 700;
          cursor: pointer;
          text-decoration: none;
          display: block;
          width: 100%;
          text-align: center;
          transition: background 0.2s, transform 0.15s;
          white-space: nowrap;
        }
        .btn-outline-cta:hover { background: ${C.tealBg}; transform: translateY(-1px); }
        .btn-outline-cta:active { transform: translateY(0); }

        .nav-cta {
          background: ${C.teal};
          color: #fff;
          border: none;
          border-radius: 8px;
          padding: 0.55rem 1.2rem;
          font-size: 0.875rem;
          font-weight: 700;
          cursor: pointer;
          text-decoration: none;
          display: inline-block;
          transition: background 0.2s;
          white-space: nowrap;
        }
        .nav-cta:hover { background: ${C.tealHover}; }

        .pricing-card { transition: box-shadow 0.2s, transform 0.2s; }
        .pricing-card:hover { box-shadow: 0 12px 40px rgba(0,0,0,0.11); transform: translateY(-2px); }

        .faq-card { transition: border-color 0.2s; }
        .faq-card:hover { border-color: ${C.tealBorder} !important; }

        .sticky-cta {
          position: fixed;
          bottom: 1.5rem;
          right: 1.5rem;
          z-index: 100;
          background: ${C.teal};
          color: #fff;
          border-radius: 999px;
          padding: 0.75rem 1.4rem;
          font-weight: 700;
          font-size: 0.9rem;
          text-decoration: none;
          display: flex;
          align-items: center;
          gap: 0.45rem;
          box-shadow: 0 4px 18px rgba(13,148,136,0.42);
          transition: background 0.2s, transform 0.15s;
          white-space: nowrap;
        }
        .sticky-cta:hover { background: ${C.tealHover}; transform: translateY(-1px); }
      `}</style>

      {/* Nav */}
      <nav
        style={{
          padding: "0 2.5rem",
          height: "64px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: `1px solid ${C.border}`,
          background: "rgba(255,255,255,0.96)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <span
          style={{
            fontSize: "1.2rem",
            fontWeight: 800,
            color: C.teal,
            letterSpacing: "-0.035em",
          }}
        >
          RandevuFlow
        </span>
        <a href={CONTACT_URL} className="nav-cta">
          Apply for pilot
        </a>
      </nav>

      {/* Hero */}
      <section>
        <div className="hero-grid">
          {/* Left */}
          <div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                background: C.tealBg,
                color: C.teal,
                fontSize: "0.8rem",
                fontWeight: 700,
                padding: "0.35rem 0.9rem",
                borderRadius: "999px",
                marginBottom: "1.75rem",
                border: `1px solid ${C.tealBorder}`,
              }}
            >
              Laser hair removal &amp; aesthetic clinics
            </div>

            <h1
              style={{
                fontSize: "clamp(1.85rem, 4.2vw, 2.75rem)",
                fontWeight: 800,
                lineHeight: 1.15,
                color: C.text,
                marginBottom: "1.25rem",
                letterSpacing: "-0.03em",
              }}
            >
              Turn WhatsApp price inquiries into appointment
              requests.
            </h1>

            <p
              style={{
                fontSize: "1.05rem",
                color: C.textMuted,
                lineHeight: 1.7,
                marginBottom: "2rem",
                maxWidth: "520px",
              }}
            >
              RandevuFlow is an AI customer assistant for laser and aesthetic
              clinics. It replies instantly, qualifies the customer, and sends
              your team a hot lead notification.
            </p>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.75rem",
                marginBottom: "1.75rem",
              }}
            >
              <a href={CONTACT_URL} className="btn-primary">
                Apply for pilot
              </a>
              <a href="#demo" className="btn-ghost">
                Watch 45-sec demo
              </a>
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "0.5rem 1rem",
                fontSize: "0.8rem",
                color: C.textMuted,
              }}
            >
              {[
                "Instant replies",
                "Hot lead notification",
                "WhatsApp",
              ].map((t) => (
                <span
                  key={t}
                  style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}
                >
                  <span
                    style={{
                      width: "5px",
                      height: "5px",
                      borderRadius: "50%",
                      background: C.teal,
                      display: "inline-block",
                      flexShrink: 0,
                    }}
                  />
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* Right - preview cards */}
          <div
            className="hero-right"
            style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
          >
            {/* Mini conversation */}
            <div
              className="hero-chat-card"
              style={{
                background: "#fff",
                border: `1px solid ${C.border}`,
                borderRadius: "20px",
                overflow: "hidden",
                boxShadow:
                  "0 8px 32px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04)",
              }}
            >
              <div
                style={{
                  background: "#075e54",
                  color: "#fff",
                  padding: "0.7rem 1rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.6rem",
                }}
              >
                <div
                  style={{
                    width: "30px",
                    height: "30px",
                    borderRadius: "50%",
                    background: "rgba(255,255,255,0.22)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.85rem",
                    flexShrink: 0,
                  }}
                >
                  💆
                </div>
                <div>
                  <div
                    style={{ fontWeight: 700, fontSize: "0.82rem", lineHeight: 1.2 }}
                  >
                    Laser &amp; Aesthetic Clinic
                  </div>
                  <div style={{ fontSize: "0.68rem", opacity: 0.85 }}>
                    replying...
                  </div>
                </div>
              </div>
              <div
                style={{
                  background: "#f0f2f5",
                  padding: "0.85rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.55rem",
                }}
              >
                {[
                  { right: true, text: "Hi, how much is full-body laser?" },
                  {
                    right: false,
                    text: "Hi! Have you had laser hair removal before?",
                  },
                  { right: true, text: "No, first time. Can do Saturday." },
                  {
                    right: false,
                    text: "Great. May I have your name and number?",
                  },
                ].map((m, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      justifyContent: m.right ? "flex-end" : "flex-start",
                    }}
                  >
                    <div
                      style={{
                        background: m.right ? "#dcf8c6" : "#fff",
                        color: C.text,
                        borderRadius: m.right
                          ? "12px 12px 3px 12px"
                          : "12px 12px 12px 3px",
                        padding: "0.45rem 0.8rem",
                        fontSize: "0.82rem",
                        maxWidth: "80%",
                        boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                        lineHeight: 1.45,
                      }}
                    >
                      {m.text}
                    </div>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "flex-start" }}>
                  <div
                    style={{
                      background: "#fff",
                      borderRadius: "12px 12px 12px 3px",
                      padding: "0.5rem 0.75rem",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                      display: "flex",
                      gap: "3px",
                      alignItems: "center",
                    }}
                  >
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        style={{
                          width: "6px",
                          height: "6px",
                          borderRadius: "50%",
                          background: "#94a3b8",
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Hot lead notification */}
            <div
              style={{
                background: C.bgDark,
                borderRadius: "16px",
                padding: "1.1rem 1.25rem",
                boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.45rem",
                  marginBottom: "0.85rem",
                }}
              >
                <span style={{ fontSize: "0.85rem" }}>🔥</span>
                <span
                  style={{ color: C.amber, fontWeight: 700, fontSize: "0.8rem" }}
                >
                  New hot lead
                </span>
                <span
                  style={{ marginLeft: "auto", fontSize: "0.7rem", color: "#475569" }}
                >
                  2 min ago
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.28rem",
                  fontSize: "0.82rem",
                }}
              >
                {(
                  [
                    ["Name", "Zeynep"],
                    ["Service", "Full body laser"],
                    ["Time", "Saturday"],
                    ["Score", "HOT"],
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <div key={k} style={{ display: "flex", gap: "0.5rem" }}>
                    <span style={{ color: "#475569", minWidth: "55px" }}>
                      {k}:
                    </span>
                    <span
                      style={{
                        color: k === "Score" ? "#34d399" : "#e2e8f0",
                        fontWeight: k === "Score" ? 700 : 400,
                      }}
                    >
                      {v}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section style={{ background: C.bgAlt, borderTop: `1px solid ${C.border}` }}>
        <div
          style={{ maxWidth: "860px", margin: "0 auto", padding: "5rem 2.5rem" }}
        >
          <h2
            style={{
              fontSize: "clamp(1.55rem, 3.2vw, 2.05rem)",
              fontWeight: 800,
              letterSpacing: "-0.025em",
              marginBottom: "1rem",
              color: C.text,
              lineHeight: 1.25,
            }}
          >
            Every unanswered price DM is a potential lead walking out the door.
          </h2>
          <p
            style={{
              fontSize: "1.05rem",
              color: C.textMuted,
              lineHeight: 1.7,
              marginBottom: "2.25rem",
              maxWidth: "560px",
            }}
          >
            Patients don&rsquo;t wait. While your team is busy with treatments,
            potential clients are sending price inquiries on Instagram and
            WhatsApp &mdash; and booking elsewhere when no one responds fast
            enough.
          </p>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.6rem",
              maxWidth: "500px",
            }}
          >
            {[
              "Price DMs left on read",
              "Unqualified leads wasting staff time",
              "Inquiries missed during peak hours and weekends",
            ].map((p) => (
              <div
                key={p}
                style={{
                  background: "#fff",
                  border: `1px solid ${C.border}`,
                  borderLeft: `3px solid ${C.red}`,
                  borderRadius: "10px",
                  padding: "0.85rem 1.1rem",
                  fontSize: "0.95rem",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: "0.65rem",
                  color: C.text,
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  style={{ flexShrink: 0 }}
                >
                  <circle cx="7" cy="7" r="7" fill="#fef2f2" />
                  <path
                    d="M4.5 4.5l5 5M9.5 4.5l-5 5"
                    stroke={C.red}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
                {p}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section>
        <div
          style={{ maxWidth: "960px", margin: "0 auto", padding: "5rem 2.5rem" }}
        >
          <h2
            style={{
              fontSize: "clamp(1.55rem, 3.2vw, 2.05rem)",
              fontWeight: 800,
              letterSpacing: "-0.025em",
              marginBottom: "0.65rem",
              color: C.text,
            }}
          >
            How RandevuFlow works
          </h2>
          <p
            style={{
              fontSize: "1rem",
              color: C.textMuted,
              lineHeight: 1.65,
              maxWidth: "500px",
            }}
          >
            Even while your team is with a patient.
          </p>
          <div className="how-it-works-grid">
            {[
              {
                n: "01",
                title: "Customer messages on WhatsApp",
                desc: "A price inquiry, appointment request, or general question arrives via WhatsApp.",
              },
              {
                n: "02",
                title: "RandevuFlow qualifies them instantly",
                desc: "It collects treatment area, first-time status, preferred time, name, and contact — automatically.",
              },
              {
                n: "03",
                title: "Your team receives a hot lead notification",
                desc: "A ready appointment request with a customer summary and recommended next action is sent to your team.",
              },
            ].map((step) => (
              <div
                key={step.n}
                style={{
                  background: "#fff",
                  border: `1px solid ${C.border}`,
                  borderRadius: "16px",
                  padding: "1.75rem 1.5rem",
                }}
              >
                <div
                  style={{
                    fontSize: "2.5rem",
                    fontWeight: 800,
                    color: C.teal,
                    lineHeight: 1,
                    marginBottom: "1rem",
                    letterSpacing: "-0.04em",
                  }}
                >
                  {step.n}
                </div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: "1rem",
                    marginBottom: "0.45rem",
                    color: C.text,
                  }}
                >
                  {step.title}
                </div>
                <div
                  style={{ fontSize: "0.9rem", color: C.textMuted, lineHeight: 1.65 }}
                >
                  {step.desc}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Demo */}
      <section
        id="demo"
        style={{ background: C.bgAlt, borderTop: `1px solid ${C.border}` }}
      >
        <div
          style={{
            maxWidth: "620px",
            margin: "0 auto",
            padding: "5rem 2.5rem",
            textAlign: "center",
          }}
        >
          <h2
            style={{
              fontSize: "clamp(1.55rem, 3.2vw, 2.05rem)",
              fontWeight: 800,
              letterSpacing: "-0.025em",
              marginBottom: "0.65rem",
              color: C.text,
            }}
          >
            See how a price inquiry becomes an appointment request.
          </h2>
          <p
            style={{
              fontSize: "1rem",
              color: C.textMuted,
              lineHeight: 1.65,
              marginBottom: "2.5rem",
              maxWidth: "460px",
              margin: "0 auto 2.5rem",
            }}
          >
            This entire conversation happens automatically — even while your
            team is with a patient.
          </p>

          <div
            style={{
              background: "#fff",
              border: `1px solid ${C.border}`,
              borderRadius: "20px",
              overflow: "hidden",
              boxShadow:
                "0 4px 24px rgba(0,0,0,0.07), 0 1px 4px rgba(0,0,0,0.04)",
              textAlign: "left",
            }}
          >
            <div
              style={{
                background: "#075e54",
                color: "#fff",
                padding: "0.9rem 1.25rem",
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
              }}
            >
              <div
                style={{
                  width: "34px",
                  height: "34px",
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.22)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "1rem",
                  flexShrink: 0,
                }}
              >
                💆
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>
                  Laser &amp; Aesthetic Clinic
                </div>
                <div style={{ fontSize: "0.72rem", opacity: 0.85 }}>
                  replying...
                </div>
              </div>
            </div>
            <div
              style={{
                padding: "1.25rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.85rem",
                background: "#f0f2f5",
              }}
            >
              {demoMessages.map((msg, i) => {
                const isCustomer = msg.who === "customer";
                return (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: isCustomer ? "flex-end" : "flex-start",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.67rem",
                        fontWeight: 600,
                        color: "#6b7280",
                        marginBottom: "3px",
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                      }}
                    >
                      {msg.name}
                    </div>
                    <div
                      style={{
                        background: isCustomer ? "#dcf8c6" : "#fff",
                        color: C.text,
                        borderRadius: isCustomer
                          ? "14px 14px 4px 14px"
                          : "14px 14px 14px 4px",
                        padding: "0.65rem 1rem",
                        fontSize: "0.9rem",
                        maxWidth: "82%",
                        boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
                        lineHeight: 1.5,
                      }}
                    >
                      {msg.text}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Extracted lead card */}
          <div
            style={{
              background: "#fff",
              border: `1px solid ${C.tealBorder}`,
              borderRadius: "16px",
              padding: "1.35rem 1.5rem",
              marginTop: "1.25rem",
              textAlign: "left",
            }}
          >
            <div
              style={{
                fontWeight: 700,
                fontSize: "0.8rem",
                color: C.teal,
                marginBottom: "0.85rem",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Extracted lead
            </div>
            <div className="collects-grid" style={{ marginTop: 0 }}>
              {collectsItems.map(({ label, value }) => (
                <div
                  key={label}
                  style={{
                    background: C.tealBg,
                    borderRadius: "10px",
                    padding: "0.6rem 0.85rem",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.68rem",
                      color: C.textMuted,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      marginBottom: "0.2rem",
                    }}
                  >
                    {label}
                  </div>
                  <div
                    style={{
                      fontSize: "0.88rem",
                      fontWeight: 700,
                      color: label === "Lead score" ? C.teal : C.text,
                    }}
                  >
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Owner notification card */}
          <div
            style={{
              background: C.bgDark,
              color: "#e2e8f0",
              borderRadius: "16px",
              padding: "1.35rem 1.5rem",
              marginTop: "1rem",
              fontSize: "0.9rem",
              lineHeight: 1.75,
              boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
              textAlign: "left",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div
              style={{
                fontWeight: 700,
                fontSize: "0.9rem",
                marginBottom: "0.85rem",
                color: C.amber,
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
              }}
            >
              <span>🔥</span>
              <span>New hot lead</span>
            </div>
            {notifRows.map(([k, v, highlight]) => (
              <div
                key={k}
                style={{ display: "flex", gap: "0.5rem", lineHeight: 1.8 }}
              >
                <span
                  style={{
                    color: "#475569",
                    minWidth: "130px",
                    fontSize: "0.85rem",
                  }}
                >
                  {k}:
                </span>
                <span
                  style={{
                    fontWeight: highlight ? 700 : 400,
                    color:
                      k === "Lead score"
                        ? "#34d399"
                        : highlight
                        ? "#f1f5f9"
                        : "#e2e8f0",
                  }}
                >
                  {v}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What RandevuFlow collects */}
      <section>
        <div
          style={{ maxWidth: "860px", margin: "0 auto", padding: "5rem 2.5rem" }}
        >
          <h2
            style={{
              fontSize: "clamp(1.55rem, 3.2vw, 2.05rem)",
              fontWeight: 800,
              letterSpacing: "-0.025em",
              marginBottom: "0.65rem",
              color: C.text,
            }}
          >
            What RandevuFlow qualifies from every inquiry
          </h2>
          <p
            style={{
              fontSize: "1rem",
              color: C.textMuted,
              lineHeight: 1.65,
              maxWidth: "500px",
              marginBottom: "2rem",
            }}
          >
            Before your team picks up the conversation, the customer is already
            qualified.
          </p>
          <div className="collects-grid">
            {[
              { icon: "💆", label: "Treatment area", desc: "Which body area or service they&rsquo;re asking about" },
              { icon: "✨", label: "Service type", desc: "Laser hair removal, skin treatment, or other" },
              { icon: "🆕", label: "First-time status", desc: "Whether this is a new or returning patient" },
              { icon: "📅", label: "Preferred time", desc: "Day or time slot that works for them" },
              { icon: "📱", label: "Name &amp; contact", desc: "Name and phone number for follow-up" },
              { icon: "🔥", label: "Lead score", desc: "HOT, WARM, or COOL — so your team knows who to call first" },
            ].map(({ icon, label, desc }) => (
              <div
                key={label}
                style={{
                  background: "#fff",
                  border: `1px solid ${C.border}`,
                  borderRadius: "14px",
                  padding: "1.25rem 1.1rem",
                }}
              >
                <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>
                  {icon}
                </div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: "0.9rem",
                    marginBottom: "0.3rem",
                    color: C.text,
                  }}
                >
                  {label}
                </div>
                <div
                  style={{ fontSize: "0.82rem", color: C.textMuted, lineHeight: 1.55 }}
                  dangerouslySetInnerHTML={{ __html: desc }}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section
        id="pricing"
        style={{ background: C.bgAlt, borderTop: `1px solid ${C.border}` }}
      >
        <div
          style={{ maxWidth: "1060px", margin: "0 auto", padding: "5rem 2.5rem" }}
        >
          <h2
            style={{
              fontSize: "clamp(1.55rem, 3.2vw, 2.05rem)",
              fontWeight: 800,
              letterSpacing: "-0.025em",
              marginBottom: "0.65rem",
              color: C.text,
            }}
          >
            We&rsquo;re working with the first 3 clinics.
          </h2>
          <p
            style={{
              fontSize: "1rem",
              color: C.textMuted,
              lineHeight: 1.65,
              maxWidth: "500px",
            }}
          >
            We set up the system in your real workflow. We evaluate results
            together within 7 days.
          </p>

          <div className="pricing-grid">
            {/* Founding Clinic Pilot - Featured */}
            <div
              className="pricing-card"
              style={{
                background: C.bgDark,
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: "20px",
                padding: "2rem 1.75rem",
                display: "flex",
                flexDirection: "column",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: "3px",
                  background: `linear-gradient(to right, ${C.teal}, #6ee7b7)`,
                }}
              />
              <div
                style={{
                  display: "inline-block",
                  background: "rgba(13,148,136,0.22)",
                  color: "#5eead4",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  padding: "0.28rem 0.75rem",
                  borderRadius: "999px",
                  marginBottom: "1rem",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  border: "1px solid rgba(13,148,136,0.32)",
                  width: "fit-content",
                }}
              >
                First 3 clinics only
              </div>
              <div
                style={{
                  fontWeight: 800,
                  fontSize: "1.2rem",
                  marginBottom: "0.3rem",
                  color: "#f1f5f9",
                }}
              >
                Founding Clinic Pilot
              </div>
              <div
                style={{
                  fontSize: "0.9rem",
                  color: "#475569",
                  marginBottom: "1.5rem",
                }}
              >
                Try the system, see the results.
              </div>
              <div style={{ marginBottom: "0.5rem" }}>
                <div
                  style={{
                    fontSize: "0.73rem",
                    color: "#475569",
                    fontWeight: 500,
                    marginBottom: "0.15rem",
                  }}
                >
                  Setup
                </div>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: "1.8rem",
                    color: "#f1f5f9",
                    letterSpacing: "-0.03em",
                  }}
                >
                  $300
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: "0.73rem",
                    color: "#475569",
                    fontWeight: 500,
                    marginBottom: "0.15rem",
                  }}
                >
                  Monthly
                </div>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: "1.8rem",
                    color: "#f1f5f9",
                    letterSpacing: "-0.03em",
                  }}
                >
                  $300
                </div>
              </div>
              <div
                style={{
                  height: "1px",
                  background: "rgba(255,255,255,0.08)",
                  margin: "1.25rem 0",
                }}
              />
              <CheckList items={pilotFeatures} white />
              <div style={{ marginTop: "auto" }}>
                <a href={CONTACT_URL} className="btn-card-cta">
                  Apply for pilot
                </a>
              </div>
            </div>

            {/* Standard */}
            <div
              className="pricing-card"
              style={{
                background: "#fff",
                border: `1px solid ${C.border}`,
                borderRadius: "20px",
                padding: "2rem 1.75rem",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  fontWeight: 800,
                  fontSize: "1.2rem",
                  marginBottom: "0.3rem",
                  color: C.text,
                }}
              >
                Standard
              </div>
              <div
                style={{
                  fontSize: "0.9rem",
                  color: C.textMuted,
                  marginBottom: "1.5rem",
                }}
              >
                For clinics ready to use the system consistently.
              </div>
              <div style={{ marginBottom: "0.5rem" }}>
                <div
                  style={{
                    fontSize: "0.73rem",
                    color: C.textMuted,
                    fontWeight: 500,
                    marginBottom: "0.15rem",
                  }}
                >
                  Setup
                </div>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: "1.8rem",
                    color: C.text,
                    letterSpacing: "-0.03em",
                  }}
                >
                  $750
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: "0.73rem",
                    color: C.textMuted,
                    fontWeight: 500,
                    marginBottom: "0.15rem",
                  }}
                >
                  Monthly
                </div>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: "1.8rem",
                    color: C.text,
                    letterSpacing: "-0.03em",
                  }}
                >
                  $500
                </div>
              </div>
              <div
                style={{
                  height: "1px",
                  background: C.border,
                  margin: "1.25rem 0",
                }}
              />
              <CheckList items={standardFeatures} />
              <div style={{ marginTop: "auto" }}>
                <a href={CONTACT_URL} className="btn-outline-cta">
                  Get in touch
                </a>
              </div>
            </div>

            {/* Clinic / Multi-location */}
            <div
              className="pricing-card"
              style={{
                background: "#fff",
                border: `1px solid ${C.border}`,
                borderRadius: "20px",
                padding: "2rem 1.75rem",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  fontWeight: 800,
                  fontSize: "1.2rem",
                  marginBottom: "0.3rem",
                  color: C.text,
                }}
              >
                Clinic / Multi-location
              </div>
              <div
                style={{
                  fontSize: "0.9rem",
                  color: C.textMuted,
                  marginBottom: "1.5rem",
                }}
              >
                For larger clinics or multi-location teams.
              </div>
              <div>
                <div
                  style={{
                    fontSize: "0.73rem",
                    color: C.textMuted,
                    fontWeight: 500,
                    marginBottom: "0.15rem",
                  }}
                >
                  Pricing
                </div>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: "1.8rem",
                    color: C.text,
                    letterSpacing: "-0.03em",
                  }}
                >
                  Custom
                </div>
              </div>
              <div
                style={{
                  height: "1px",
                  background: C.border,
                  margin: "1.25rem 0",
                }}
              />
              <CheckList items={clinicFeatures} />
              <div style={{ marginTop: "auto" }}>
                <a href={CONTACT_URL} className="btn-outline-cta">
                  Request a quote
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust signal */}
      <div style={{ background: C.bg, borderTop: `1px solid ${C.border}` }}>
        <div
          style={{
            maxWidth: "720px",
            margin: "0 auto",
            padding: "1.75rem 2.5rem",
            textAlign: "center",
            fontSize: "0.9rem",
            color: C.textMuted,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
          }}
        >
          <span
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: C.teal,
              display: "inline-block",
              flexShrink: 0,
            }}
          />
          Founding clinics receive hands-on setup and manual quality review.
        </div>
      </div>

      {/* FAQ */}
      <section style={{ background: C.bgAlt, borderTop: `1px solid ${C.border}` }}>
        <div
          style={{ maxWidth: "720px", margin: "0 auto", padding: "5rem 2.5rem" }}
        >
          <h2
            style={{
              fontSize: "clamp(1.55rem, 3.2vw, 2.05rem)",
              fontWeight: 800,
              letterSpacing: "-0.025em",
              marginBottom: "2rem",
              color: C.text,
            }}
          >
            Frequently asked questions
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {faqs.map((faq) => (
              <div
                key={faq.q}
                className="faq-card"
                style={{
                  background: "#fff",
                  border: `1px solid ${C.border}`,
                  borderRadius: "14px",
                  padding: "1.25rem 1.5rem",
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: "0.975rem",
                    marginBottom: "0.55rem",
                    color: C.text,
                    lineHeight: 1.45,
                  }}
                >
                  {faq.q}
                </div>
                <div
                  style={{
                    fontSize: "0.9rem",
                    color: C.textMuted,
                    lineHeight: 1.65,
                  }}
                >
                  {faq.a}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section
        style={{
          background: `linear-gradient(135deg, ${C.bgDark} 0%, #0f1f3d 55%, #0c2030 100%)`,
          borderTop: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div
          style={{
            maxWidth: "640px",
            margin: "0 auto",
            padding: "5.5rem 2.5rem",
            textAlign: "center",
          }}
        >
          <h2
            style={{
              fontSize: "clamp(1.75rem, 4vw, 2.5rem)",
              fontWeight: 800,
              color: "#f1f5f9",
              marginBottom: "1rem",
              letterSpacing: "-0.03em",
              lineHeight: 1.2,
            }}
          >
            Let&rsquo;s set up a free pilot demo for your clinic.
          </h2>
          <p
            style={{
              color: "#64748b",
              fontSize: "1rem",
              lineHeight: 1.65,
              maxWidth: "420px",
              margin: "0 auto 2.25rem",
            }}
          >
            Tell us about your services. We&rsquo;ll configure the flow and
            test it together.
          </p>
          <a href={CONTACT_URL} className="btn-primary-lg">
            Apply for pilot
          </a>
        </div>
      </section>

      {/* Compliance note */}
      <div style={{ background: C.bgAlt, borderTop: `1px solid ${C.border}` }}>
        <div
          style={{
            maxWidth: "720px",
            margin: "0 auto",
            padding: "1.5rem 2.5rem",
            textAlign: "center",
            fontSize: "0.8rem",
            color: C.textMuted,
            lineHeight: 1.6,
          }}
        >
          RandevuFlow helps clinics manage the information-gathering and
          follow-up process after a customer reaches out. It is not designed
          for unsolicited bulk messaging. It does not provide medical advice or
          treatment recommendations.
        </div>
      </div>

      {/* Footer */}
      <footer
        style={{
          background: C.bgDark,
          color: "#475569",
          textAlign: "center",
          padding: "2rem 2.5rem",
          fontSize: "0.875rem",
          borderTop: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div>
          <strong style={{ color: "#e2e8f0" }}>RandevuFlow</strong> &mdash; AI
          customer assistant for laser hair removal and aesthetic clinics.
        </div>
        <div style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}>
          WhatsApp &middot; Instant replies &middot; Hot lead notifications
        </div>
      </footer>

      {/* Sticky CTA */}
      <a href={CONTACT_URL} className="sticky-cta">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.02 1.18 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92v2z" />
        </svg>
        <span>Apply for pilot</span>
      </a>
    </div>
  );
}
