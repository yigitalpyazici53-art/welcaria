"use client";

import { useState, useEffect } from "react";
import { Outfit, Plus_Jakarta_Sans } from "next/font/google";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta-sans",
  display: "swap",
});

const T = {
  tr: {
    navCta: "Demo talep edin",
    badgeText: "AI destekli WhatsApp asistanı",
    heroTitle1: "Her hasta mesajına ",
    heroGradient: "anında yanıt",
    heroSub:
      "WhatsApp'tan gelen mesajlara saniyeler içinde, hastanın dilinde profesyonel karşılama. 7/24, yılın her günü.",
    heroCta: "Ücretsiz demoyu deneyin",
    pTag: "SORUN",
    pTitle: "Kaçırılan mesajlar, kaybedilen hastalar",
    c1t: "Gece gelen mesajlar",
    c1b: "Uluslararası hasta gece 23:00'te yazar. Sabaha dönen yanıt, çoktan rakibe gitmiş bir hastadır.",
    c2t: "Dil bariyeri",
    c2b: "Almanca veya Arapça gelen mesaja yanıt veremezseniz, hasta güvenini ilk saniyede kaybedersiniz.",
    c3t: "Yoğun saatlerde kayıp",
    c3b: "Klinik dolu, telefon susmuyor. Okunmayan her WhatsApp mesajı sessizce kaybolur.",
    hTag: "SÜREÇ",
    hTitle: "Nasıl çalışır?",
    s1t: "Hasta yazıyor",
    s1b: "Yeni mesaj geldiği anda Welcaria devreye girer, dili otomatik algılar.",
    s2t: "Anında karşılama ve niteleme",
    s2b: "Tedavi, tarih ve iletişim bilgilerini profesyonel bir akışla toplar.",
    s3t: "Sıcak hasta size iletilir",
    s3b: "Nitelenen hasta anında bildirilir, görüşmeyi istediğiniz yerden devralırsınız.",
    ctrlT: "Kontrol tamamen sizde",
    ctrlB:
      "Canlı inbox panelinden tüm konuşmaları izleyin, tek tıkla botu durdurup görüşmeyi devralın.",
    lTag: "GLOBAL",
    lTitle: "6 dilde profesyonel karşılama",
    verts: "Diş · Saç ekimi · Estetik · Lazer",
    trustT: "WhatsApp Cloud API ile güvenli entegrasyon",
    prTag: "FİYATLANDIRMA",
    prTitle: "Basit fiyatlandırma",
    planN: "Pilot Paket",
    trialB: "2 hafta ücretsiz",
    pricePer: "/ay",
    feats: [
      "7/24 otomatik hasta karşılama",
      "6 dil desteği",
      "Hasta niteleme ve sıcaklık skoru",
      "Canlı inbox paneli",
      "Anlık sıcak hasta bildirimleri",
      "Tek tıkla bot durdurma ve devralma",
    ],
    prCta: "Ücretsiz demo başlatın",
    footC: "© 2026 Welcaria. Tüm hakları saklıdır.",
    chatName: "Kliniğiniz",
    chatSt: "çevrimiçi",
  },
  en: {
    navCta: "Request a demo",
    badgeText: "AI-powered WhatsApp assistant",
    heroTitle1: "Instant reply to every ",
    heroGradient: "patient message",
    heroSub:
      "Professional greeting in the patient's language within seconds via WhatsApp. 24/7, every day of the year.",
    heroCta: "Try the free demo",
    pTag: "PROBLEM",
    pTitle: "Missed messages, lost patients",
    c1t: "Late-night messages",
    c1b: "An international patient texts at 11 PM. By morning, your delayed reply has sent them to a competitor.",
    c2t: "Language barrier",
    c2b: "If you can't respond to a German or Arabic message, you lose the patient's trust in the first second.",
    c3t: "Lost in the rush",
    c3b: "The clinic is packed, phones won't stop ringing. Every unread WhatsApp silently disappears.",
    hTag: "PROCESS",
    hTitle: "How it works",
    s1t: "Patient sends a message",
    s1b: "The moment a new message arrives, Welcaria activates and detects the language automatically.",
    s2t: "Instant greeting & qualification",
    s2b: "Collects treatment, date and contact info through a professional conversation flow.",
    s3t: "Hot lead forwarded to you",
    s3b: "Qualified patients are instantly notified; you take over the conversation whenever you want.",
    ctrlT: "You're always in control",
    ctrlB:
      "Monitor every conversation from the live inbox, pause the bot with one click and take over.",
    lTag: "GLOBAL",
    lTitle: "Professional greeting in 6 languages",
    verts: "Dental · Hair transplant · Aesthetics · Laser",
    trustT: "Secure integration via WhatsApp Cloud API",
    prTag: "PRICING",
    prTitle: "Simple pricing",
    planN: "Pilot Package",
    trialB: "2 weeks free",
    pricePer: "/mo",
    feats: [
      "24/7 automated patient greeting",
      "6 language support",
      "Patient qualification & lead scoring",
      "Live inbox panel",
      "Instant hot lead notifications",
      "One-click bot pause & takeover",
    ],
    prCta: "Start free demo",
    footC: "© 2026 Welcaria. All rights reserved.",
    chatName: "Your Clinic",
    chatSt: "online",
  },
};

const WA_LINK =
  "https://wa.me/905419473049?text=Merhaba!%20Welcaria%20demosu%20talep%20etmek%20istiyorum.";

const CheckIcon = () => (
  <svg width="15" height="15" viewBox="0 0 17 17" fill="none">
    <circle cx="8.5" cy="8.5" r="8.5" fill="var(--accent-soft)" />
    <path
      d="M5.5 8.5L7.5 10.5L11.5 6.5"
      stroke="var(--accent)"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const Ticks = () => (
  <svg
    className="ticks"
    width="13"
    height="9"
    viewBox="0 0 16 11"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
  >
    <path d="M1 5.5L4 8.5L9.5 1.5" />
    <path d="M7 5.5L10 8.5L15.5 1.5" />
  </svg>
);

export default function Home() {
  const [lang, setLang] = useState<"tr" | "en">("tr");
  const t = T[lang];

  useEffect(() => {
    try {
      const saved = localStorage.getItem("wl");
      if (saved === "en") setLang("en");
    } catch {}
  }, []);

  const switchLang = (l: "tr" | "en") => {
    setLang(l);
    try {
      localStorage.setItem("wl", l);
    } catch {}
  };

  return (
    <div className={`${outfit.variable} ${jakarta.variable}`}>
      <style jsx global>{`
        :root {
          --bg: #ffffff;
          --bg-subtle: #f7f7f5;
          --bg-card: #ffffff;
          --fg: #1a1a1a;
          --fg-secondary: #555555;
          --fg-muted: #999999;
          --accent: #5b4cf0;
          --accent-soft: rgba(91, 76, 240, 0.08);
          --accent-border: rgba(91, 76, 240, 0.15);
          --wa: #25d366;
          --wa-dark: #1db954;
          --border: #ebebeb;
          --border-light: #f0f0f0;
          --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.04);
          --shadow-md: 0 4px 20px rgba(0, 0, 0, 0.06);
          --shadow-lg: 0 16px 48px rgba(0, 0, 0, 0.08);
          --radius: 14px;
          --font-display: var(--font-outfit, "Outfit", system-ui, sans-serif);
          --font-body: var(
            --font-plus-jakarta-sans,
            "Plus Jakarta Sans",
            system-ui,
            sans-serif
          );
        }

        body {
          background: var(--bg);
          color: var(--fg);
          font-family: var(--font-body);
          -webkit-font-smoothing: antialiased;
          overflow-x: hidden;
        }

        *,
        *::before,
        *::after {
          box-sizing: border-box;
        }

        h1, h2, h3, h4 {
          font-family: var(--font-display);
          text-wrap: balance;
          letter-spacing: -0.025em;
        }

        a { color: inherit; text-decoration: none; }

        .wrap {
          max-width: 1080px;
          margin: 0 auto;
          padding-inline: 24px;
        }

        .gradient-bg {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          overflow: hidden;
        }
        .gradient-blob {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.5;
        }
        .blob-1 {
          width: 600px; height: 600px;
          background: radial-gradient(circle, rgba(91,76,240,0.2), transparent 70%);
          top: -120px; right: -80px;
          animation: blobDrift1 20s ease-in-out infinite alternate;
        }
        .blob-2 {
          width: 500px; height: 500px;
          background: radial-gradient(circle, rgba(56,189,248,0.15), transparent 70%);
          top: 30%; left: -120px;
          animation: blobDrift2 24s ease-in-out infinite alternate;
        }
        .blob-3 {
          width: 450px; height: 450px;
          background: radial-gradient(circle, rgba(168,85,247,0.12), transparent 70%);
          bottom: -100px; right: 20%;
          animation: blobDrift3 18s ease-in-out infinite alternate;
        }
        @media (prefers-reduced-motion: reduce) {
          .blob-1, .blob-2, .blob-3 { animation: none; }
        }
        @keyframes blobDrift1 {
          0%   { transform: translate(0, 0) scale(1); }
          50%  { transform: translate(-60px, 40px) scale(1.1); }
          100% { transform: translate(30px, -20px) scale(0.95); }
        }
        @keyframes blobDrift2 {
          0%   { transform: translate(0, 0) scale(1); }
          50%  { transform: translate(50px, -30px) scale(1.05); }
          100% { transform: translate(-20px, 60px) scale(0.98); }
        }
        @keyframes blobDrift3 {
          0%   { transform: translate(0, 0) scale(1); }
          50%  { transform: translate(-40px, -50px) scale(1.08); }
          100% { transform: translate(40px, 20px) scale(0.92); }
        }

        .nav {
          position: sticky;
          top: 0;
          z-index: 100;
          background: color-mix(in srgb, var(--bg) 80%, transparent);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-bottom: 1px solid var(--border-light);
        }
        .nav-inner {
          height: 56px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .logo {
          font-family: var(--font-display);
          font-size: 1.25rem;
          font-weight: 800;
          letter-spacing: -0.05em;
          color: var(--fg);
        }
        .logo-dot { color: var(--accent); }
        .nav-right {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .lang-sw {
          display: flex;
          background: var(--bg-subtle);
          border: 1px solid var(--border-light);
          border-radius: 8px;
          padding: 2px;
        }
        .lang-sw button {
          background: none;
          border: none;
          padding: 5px 12px;
          font-family: var(--font-display);
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--fg-muted);
          cursor: pointer;
          border-radius: 6px;
          transition: all 0.2s;
          letter-spacing: 0.03em;
        }
        .lang-sw button.on {
          background: var(--bg-card);
          color: var(--fg);
          box-shadow: var(--shadow-sm);
        }
        .nav-btn {
          background: var(--fg);
          color: var(--bg);
          font-family: var(--font-display);
          font-size: 0.8rem;
          font-weight: 700;
          padding: 7px 16px;
          border-radius: 8px;
          transition: opacity 0.2s;
          display: none;
        }
        @media (min-width: 640px) { .nav-btn { display: inline-block; } }
        .nav-btn:hover { opacity: 0.85; }

        section { position: relative; z-index: 1; }

        .hero {
          text-align: center;
          padding: 80px 0 60px;
          max-width: 720px;
          margin: 0 auto;
        }
        @media (max-width: 640px) { .hero { padding: 48px 0 40px; } }
        .hero-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: var(--accent-soft);
          border: 1px solid var(--accent-border);
          border-radius: 999px;
          padding: 5px 14px 5px 10px;
          font-size: 0.78rem;
          font-weight: 600;
          color: var(--accent);
          margin-bottom: 28px;
          font-family: var(--font-display);
        }
        .hero-badge-dot {
          width: 6px; height: 6px;
          border-radius: 50%;
          background: var(--accent);
          animation: pulse 2s ease-in-out infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.8); }
        }
        .hero h1 {
          font-size: clamp(2.4rem, 6vw, 3.6rem);
          font-weight: 800;
          line-height: 1.08;
          margin-bottom: 20px;
          color: var(--fg);
        }
        .hero-gradient {
          background: linear-gradient(135deg, var(--accent), #38bdf8, #a855f7);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .hero p {
          font-size: 1.1rem;
          line-height: 1.7;
          color: var(--fg-secondary);
          max-width: 520px;
          margin: 0 auto 36px;
        }
        .hero-actions {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 14px;
          flex-wrap: wrap;
        }
        .btn-wa {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: var(--wa);
          color: #fff;
          font-family: var(--font-display);
          font-size: 0.95rem;
          font-weight: 700;
          padding: 13px 28px;
          border-radius: 12px;
          transition: all 0.25s;
          box-shadow: 0 2px 12px rgba(37, 211, 102, 0.2);
        }
        .btn-wa:hover {
          background: var(--wa-dark);
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(37, 211, 102, 0.25);
        }

        .chat-section { padding: 0 0 80px; }
        .chat-frame {
          max-width: 420px;
          margin: 0 auto;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 16px;
          overflow: hidden;
          box-shadow: var(--shadow-lg);
        }
        .chat-head {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 16px;
          background: var(--bg-subtle);
          border-bottom: 1px solid var(--border-light);
        }
        .chat-av {
          width: 34px; height: 34px;
          border-radius: 50%;
          background: var(--accent-soft);
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-display);
          font-weight: 800;
          font-size: 0.75rem;
          color: var(--accent);
          flex-shrink: 0;
        }
        .chat-name {
          font-family: var(--font-display);
          font-weight: 600;
          font-size: 0.86rem;
          color: var(--fg);
          line-height: 1.2;
        }
        .chat-status { font-size: 0.7rem; color: var(--fg-muted); }
        .chat-msgs {
          padding: 14px 12px 18px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .m {
          max-width: 82%;
          padding: 10px 13px 6px;
          border-radius: 14px;
          font-size: 0.82rem;
          line-height: 1.55;
        }
        .m-in {
          align-self: flex-start;
          background: var(--bg-subtle);
          color: var(--fg);
          border-bottom-left-radius: 4px;
        }
        .m-out {
          align-self: flex-end;
          background: #dcf8c6;
          color: #1a1a1a;
          border-bottom-right-radius: 4px;
        }
        .m-foot {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 6px;
          margin-top: 3px;
        }
        .m-lang {
          font-family: var(--font-display);
          font-size: 0.56rem;
          font-weight: 700;
          color: var(--accent);
          background: var(--accent-soft);
          border-radius: 3px;
          padding: 1px 5px;
          letter-spacing: 0.06em;
        }
        .m-time { font-size: 0.62rem; color: var(--fg-muted); }
        .ticks { color: #53bdeb; }

        .sec { padding: 80px 0; }
        @media (max-width: 640px) { .sec { padding: 56px 0; } }
        .sec-label {
          font-family: var(--font-display);
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--accent);
          margin-bottom: 12px;
        }
        .sec-title {
          font-size: clamp(1.5rem, 3vw, 2.2rem);
          font-weight: 700;
          line-height: 1.15;
          margin-bottom: 44px;
          color: var(--fg);
          max-width: 480px;
        }
        .sec-title-center {
          text-align: center;
          margin-left: auto;
          margin-right: auto;
        }
        .sec-label-center { text-align: center; }

        .cards-3 {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
        }
        @media (max-width: 760px) { .cards-3 { grid-template-columns: 1fr; } }
        .card {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 26px 22px;
          transition: box-shadow 0.3s, border-color 0.3s;
        }
        .card:hover {
          border-color: var(--accent-border);
          box-shadow: var(--shadow-md);
        }
        .card-icon {
          width: 38px; height: 38px;
          border-radius: 10px;
          background: var(--accent-soft);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 16px;
          color: var(--accent);
        }
        .card h3 {
          font-size: 0.95rem;
          font-weight: 700;
          margin-bottom: 8px;
          color: var(--fg);
        }
        .card p {
          font-size: 0.88rem;
          line-height: 1.7;
          color: var(--fg-secondary);
        }

        .steps { max-width: 560px; }
        .step { display: flex; gap: 18px; }
        .step-rail {
          display: flex;
          flex-direction: column;
          align-items: center;
          flex-shrink: 0;
        }
        .step-dot {
          width: 36px; height: 36px;
          border-radius: 50%;
          border: 2px solid var(--accent);
          background: var(--accent-soft);
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 0.85rem;
          color: var(--accent);
          flex-shrink: 0;
        }
        .step-line {
          width: 1px;
          flex: 1;
          background: var(--border);
          margin: 4px 0;
        }
        .step-body { padding-bottom: 32px; }
        .step h3 {
          font-size: 1rem;
          font-weight: 700;
          margin: 6px 0 4px;
          color: var(--fg);
        }
        .step p {
          font-size: 0.88rem;
          line-height: 1.7;
          color: var(--fg-secondary);
        }

        .ctrl {
          margin-top: 32px;
          max-width: 560px;
          background: var(--bg-subtle);
          border: 1px solid var(--border);
          border-left: 3px solid var(--accent);
          border-radius: var(--radius);
          padding: 18px 20px;
          display: flex;
          gap: 12px;
          align-items: flex-start;
        }
        .ctrl-icon { flex-shrink: 0; margin-top: 2px; color: var(--accent); }
        .ctrl h4 {
          font-size: 0.92rem;
          font-weight: 700;
          margin-bottom: 4px;
          color: var(--fg);
        }
        .ctrl p {
          font-size: 0.86rem;
          line-height: 1.65;
          color: var(--fg-secondary);
        }

        .lang-sec { text-align: center; }
        .verticals {
          font-size: 0.9rem;
          color: var(--fg-muted);
          margin-bottom: 28px;
          letter-spacing: 0.06em;
        }
        .pills {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 8px;
          max-width: 540px;
          margin: 0 auto 24px;
        }
        .pill {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          border: 1px solid var(--border);
          border-radius: 999px;
          padding: 7px 16px;
          font-size: 0.86rem;
          font-weight: 500;
          color: var(--fg);
          background: var(--bg-card);
          transition: border-color 0.2s;
        }
        .pill:hover { border-color: var(--accent-border); }
        .pill-code {
          font-family: var(--font-display);
          font-size: 0.65rem;
          font-weight: 700;
          color: var(--accent);
          letter-spacing: 0.06em;
        }
        .trust {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font-size: 0.86rem;
          color: var(--fg-muted);
        }
        .trust svg { color: var(--accent); flex-shrink: 0; }

        .price-card {
          max-width: 400px;
          margin: 0 auto;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 28px 24px;
          box-shadow: var(--shadow-md);
        }
        .price-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 18px;
        }
        .plan-label {
          font-family: var(--font-display);
          font-size: 0.9rem;
          font-weight: 700;
          color: var(--accent);
        }
        .trial {
          font-family: var(--font-display);
          font-size: 0.68rem;
          font-weight: 700;
          color: var(--accent);
          background: var(--accent-soft);
          border: 1px solid var(--accent-border);
          border-radius: 999px;
          padding: 4px 12px;
        }
        .price-num {
          display: flex;
          align-items: baseline;
          gap: 4px;
          margin-bottom: 22px;
        }
        .price-big {
          font-family: var(--font-display);
          font-size: 2.8rem;
          font-weight: 800;
          color: var(--fg);
          letter-spacing: -0.04em;
          line-height: 1;
          font-variant-numeric: tabular-nums;
        }
        .price-per { font-size: 0.95rem; color: var(--fg-muted); }
        .feat-list {
          border-top: 1px solid var(--border-light);
          padding-top: 18px;
          margin-bottom: 24px;
          display: flex;
          flex-direction: column;
          gap: 9px;
        }
        .feat {
          display: flex;
          align-items: flex-start;
          gap: 9px;
          font-size: 0.88rem;
          color: var(--fg);
        }
        .feat svg { flex-shrink: 0; margin-top: 3px; color: var(--accent); }
        .btn-full {
          display: block;
          width: 100%;
          text-align: center;
          background: var(--wa);
          color: #fff;
          font-family: var(--font-display);
          font-size: 0.95rem;
          font-weight: 700;
          padding: 13px 24px;
          border-radius: 12px;
          border: none;
          cursor: pointer;
          transition: all 0.25s;
        }
        .btn-full:hover {
          background: var(--wa-dark);
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(37, 211, 102, 0.2);
        }

        .div-line {
          height: 1px;
          border: none;
          background: var(--border);
          position: relative;
          z-index: 1;
          margin: 0;
        }

        .foot {
          border-top: 1px solid var(--border-light);
          padding: 24px 0;
          position: relative;
          z-index: 1;
        }
        .foot-inner {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .foot-mail {
          color: var(--fg-muted);
          font-size: 0.86rem;
          transition: color 0.2s;
        }
        .foot-mail:hover { color: var(--accent); }
        .foot-copy { font-size: 0.76rem; color: var(--fg-muted); }
      `}</style>

      {/* Gradient mesh background */}
      <div className="gradient-bg" aria-hidden="true">
        <div className="gradient-blob blob-1" />
        <div className="gradient-blob blob-2" />
        <div className="gradient-blob blob-3" />
      </div>

      {/* Nav */}
      <nav className="nav">
        <div className="wrap nav-inner">
          <div className="logo">
            welcaria<span className="logo-dot">.</span>
          </div>
          <div className="nav-right">
            <div className="lang-sw">
              <button
                className={lang === "tr" ? "on" : ""}
                onClick={() => switchLang("tr")}
              >
                TR
              </button>
              <button
                className={lang === "en" ? "on" : ""}
                onClick={() => switchLang("en")}
              >
                EN
              </button>
            </div>
            <a href={WA_LINK} className="nav-btn">
              {t.navCta}
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section>
        <div className="wrap">
          <div className="hero">
            <div className="hero-badge">
              <span className="hero-badge-dot" />
              <span>{t.badgeText}</span>
            </div>
            <h1>
              {t.heroTitle1}
              <span className="hero-gradient">{t.heroGradient}</span>
            </h1>
            <p>{t.heroSub}</p>
            <div className="hero-actions">
              <a href={WA_LINK} className="btn-wa">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                  <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a8 8 0 01-4.29-1.24l-.28-.168-2.9.76.78-2.84-.19-.3A8 8 0 1112 20z" />
                </svg>
                <span>{t.heroCta}</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Chat demo */}
      <section className="chat-section">
        <div className="wrap">
          <div className="chat-frame">
            <div className="chat-head">
              <div className="chat-av">W</div>
              <div>
                <div className="chat-name">{t.chatName}</div>
                <div className="chat-status">{t.chatSt}</div>
              </div>
            </div>
            <div className="chat-msgs">
              <div className="m m-in">
                Guten Tag, ich interessiere mich für eine Haartransplantation.
                <div className="m-foot">
                  <span className="m-lang">DE</span>
                  <span className="m-time">23:47</span>
                </div>
              </div>
              <div className="m m-out">
                Guten Tag! Welche Methode bevorzugen Sie – FUE oder DHI?
                <div className="m-foot">
                  <span className="m-time">23:47</span>
                  <Ticks />
                </div>
              </div>
              <div className="m m-in">
                Hi, do you have availability next week for dental veneers?
                <div className="m-foot">
                  <span className="m-lang">EN</span>
                  <span className="m-time">23:51</span>
                </div>
              </div>
              <div className="m m-out">
                Hello! Yes, we have openings. How many veneers are you considering?
                <div className="m-foot">
                  <span className="m-time">23:51</span>
                  <Ticks />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <hr className="div-line" />

      {/* Problems */}
      <section className="sec">
        <div className="wrap">
          <div className="sec-label">{t.pTag}</div>
          <h2 className="sec-title">{t.pTitle}</h2>
          <div className="cards-3">
            <div className="card">
              <div className="card-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
              </div>
              <h3>{t.c1t}</h3>
              <p>{t.c1b}</p>
            </div>
            <div className="card">
              <div className="card-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M5 8l6 6" />
                  <path d="M4 14l6-6 2-3" />
                  <path d="M2 5h5" />
                  <path d="M20 8l-6 6" />
                  <path d="M20 14l-6-6-2-3" />
                  <path d="M17 5h5" />
                </svg>
              </div>
              <h3>{t.c2t}</h3>
              <p>{t.c2b}</p>
            </div>
            <div className="card">
              <div className="card-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                </svg>
              </div>
              <h3>{t.c3t}</h3>
              <p>{t.c3b}</p>
            </div>
          </div>
        </div>
      </section>

      <hr className="div-line" />

      {/* How it works */}
      <section className="sec">
        <div className="wrap">
          <div className="sec-label">{t.hTag}</div>
          <h2 className="sec-title">{t.hTitle}</h2>
          <div className="steps">
            <div className="step">
              <div className="step-rail">
                <div className="step-dot">1</div>
                <div className="step-line" />
              </div>
              <div className="step-body">
                <h3>{t.s1t}</h3>
                <p>{t.s1b}</p>
              </div>
            </div>
            <div className="step">
              <div className="step-rail">
                <div className="step-dot">2</div>
                <div className="step-line" />
              </div>
              <div className="step-body">
                <h3>{t.s2t}</h3>
                <p>{t.s2b}</p>
              </div>
            </div>
            <div className="step">
              <div className="step-rail">
                <div className="step-dot">3</div>
              </div>
              <div className="step-body" style={{ paddingBottom: 0 }}>
                <h3>{t.s3t}</h3>
                <p>{t.s3b}</p>
              </div>
            </div>
          </div>
          <div className="ctrl">
            <svg className="ctrl-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
            <div>
              <h4>{t.ctrlT}</h4>
              <p>{t.ctrlB}</p>
            </div>
          </div>
        </div>
      </section>

      <hr className="div-line" />

      {/* Languages */}
      <section className="sec lang-sec">
        <div className="wrap">
          <div className="sec-label sec-label-center">{t.lTag}</div>
          <h2 className="sec-title sec-title-center">{t.lTitle}</h2>
          <p className="verticals">{t.verts}</p>
          <div className="pills">
            {[
              ["TR", "Türkçe"],
              ["EN", "English"],
              ["DE", "Deutsch"],
              ["FR", "Français"],
              ["AR", "العربية"],
              ["RU", "Русский"],
            ].map(([code, name]) => (
              <span className="pill" key={code}>
                <span className="pill-code">{code}</span>
                {name}
              </span>
            ))}
          </div>
          <p className="trust">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l7 3v5.5c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5V6l7-3z" />
              <path d="M9.2 12.2l2 2 3.6-3.9" />
            </svg>
            <span>{t.trustT}</span>
          </p>
        </div>
      </section>

      <hr className="div-line" />

      {/* Footer */}
      <footer className="foot">
        <div className="wrap foot-inner">
          <div className="logo" style={{ fontSize: "1.05rem" }}>
            welcaria<span className="logo-dot">.</span>
          </div>
          <a href="mailto:info@welcaria.com" className="foot-mail">
            info@welcaria.com
          </a>
          <span className="foot-copy">{t.footC}</span>
        </div>
      </footer>
    </div>
  );
}
