import { Outfit } from "next/font/google";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const CONTACT_URL = "mailto:yigitalpyazici53@gmail.com?subject=RandevuFlow%20Pilot%20Ba%C5%9Fvurusu";

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
  whatsapp: "#25d366",
  amber: "#f59e0b",
  red: "#ef4444",
};

function CheckIcon({ white }: { white?: boolean }) {
  const fill = white ? "rgba(13,148,136,0.28)" : C.tealBg;
  const stroke = white ? "#5eead4" : C.teal;
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" style={{ flexShrink: 0, marginTop: "1px" }}>
      <circle cx="8.5" cy="8.5" r="8.5" fill={fill} />
      <path d="M5.5 8.5L7.5 10.5L11.5 6.5" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckList({ items, white }: { items: string[]; white?: boolean }) {
  return (
    <div style={{ margin: "1.5rem 0" }}>
      {items.map((item) => (
        <div key={item} style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem", padding: "0.35rem 0", fontSize: "0.9rem", color: white ? "#cbd5e1" : C.text }}>
          <CheckIcon white={white} />
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

const pilotFeatures = [
  "WhatsApp/Instagram konuşma akışı",
  "Hizmet ve randevu bilgisi toplama",
  "Google Sheets kaydı",
  "Sıcak müşteri bildirimi",
  "7 gün ayar ve iyileştirme",
];

const standartFeatures = [
  "Tüm Pilot özellikleri",
  "Lead scoring",
  "Takip mesajları",
  "Aylık performans özeti",
  "Daha gelişmiş konuşma senaryoları",
];

const klinikFeatures = [
  "Çoklu hizmet senaryoları",
  "Personel yönlendirme",
  "Gelişmiş bildirim sistemi",
  "Yurtdışı hasta/müşteri akışları",
  "Öncelikli destek",
];

const faqs = [
  {
    q: "Yapay zeka yanlış fiyat söyler mi?",
    a: "Hayır. Sistem yalnızca işletmenin verdiği fiyat aralıklarını ve onaylı bilgileri kullanır. Emin olmadığı durumda müşteriyi işletmeye yönlendirir.",
  },
  {
    q: "Kurulum ne kadar sürer?",
    a: "İlk kurulum genellikle 1-2 gün içinde tamamlanır. Hizmetleriniz, fiyat aralıklarınız ve sık sorulan sorularınız alınarak sistem size özel hazırlanır.",
  },
  {
    q: "Müşteri verileri güvende mi?",
    a: "Müşteri bilgileri yalnızca randevu ve iletişim amacıyla toplanır. KVKK'ya uygun şekilde saklanması için gerekli yapı kurulur.",
  },
  {
    q: "Sistem müşteriye tıbbi tavsiye verir mi?",
    a: "Hayır. Sistem tıbbi tavsiye veya teşhis vermez. Estetik/klinik konularda müşteriyi ön görüşmeye veya uzman ekibe yönlendirir.",
  },
  {
    q: "İstediğim zaman iptal edebilir miyim?",
    a: "Evet. Pilot müşteriler için esnek aylık kullanım sunulur.",
  },
];

const demoMessages = [
  { who: "customer", name: "Zeynep", text: "Merhaba, tüm vücut lazer epilasyon fiyatı ne kadar?" },
  { who: "assistant", name: "RandevuFlow", text: "Merhaba! Size yardımcı olalım. Tüm vücut lazer paketleri seans sayısı ve kampanyaya göre değişebilir. Daha önce lazer epilasyon yaptırdınız mı?" },
  { who: "customer", name: "Zeynep", text: "Hayır, ilk kez yaptıracağım." },
  { who: "assistant", name: "RandevuFlow", text: "Anladım. İlk kez gelen danışanlar için ön görüşme ve cilt analizi öneriyoruz. Bu hafta hangi gün sizin için uygun olur?" },
  { who: "customer", name: "Zeynep", text: "Cumartesi olabilir." },
  { who: "assistant", name: "RandevuFlow", text: "Harika. Cumartesi için ön kayıt oluşturalım. İsminizi ve telefon numaranızı alabilir miyiz?" },
  { who: "customer", name: "Zeynep", text: "Zeynep, 0532 xxx xx xx." },
  { who: "assistant", name: "RandevuFlow", text: "Teşekkürler Zeynep Hanım. Cumartesi için randevu talebinizi aldık. Merkezimiz uygun saat bilgisini paylaşmak ve ön kaydınızı onaylamak için size kısa süre içinde dönüş yapacak." },
];

const notifRows: [string, string][] = [
  ["İsim", "Zeynep"],
  ["Hizmet", "Tüm vücut lazer epilasyon"],
  ["Durum", "İlk kez yaptıracak"],
  ["Zaman", "Cumartesi"],
  ["Telefon", "0532 xxx xx xx"],
  ["Lead skoru", "Yüksek"],
  ["Öneri", "Hızlı dönüş yapılmalı"],
];

export default function Home() {
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

        .pricing-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1.5rem;
          margin-top: 2.5rem;
        }
        @media (max-width: 900px) {
          .pricing-grid { grid-template-columns: 1fr; max-width: 460px; margin-left: auto; margin-right: auto; }
        }

        .btn-wa {
          background: ${C.whatsapp};
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
        .btn-wa:hover { background: #1da851; transform: translateY(-1px); }
        .btn-wa:active { transform: translateY(0); }

        .btn-wa-lg {
          background: ${C.whatsapp};
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
        .btn-wa-lg:hover { background: #1da851; transform: translateY(-1px); }
        .btn-wa-lg:active { transform: translateY(0); }

        .btn-pilot-cta {
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
        .btn-pilot-cta:hover { background: ${C.tealHover}; transform: translateY(-1px); }
        .btn-pilot-cta:active { transform: translateY(0); }

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
          background: ${C.whatsapp};
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
        .nav-cta:hover { background: #1da851; }

        .pricing-card { transition: box-shadow 0.2s, transform 0.2s; }
        .pricing-card:hover { box-shadow: 0 12px 40px rgba(0,0,0,0.11); transform: translateY(-2px); }

        .faq-card { transition: border-color 0.2s; }
        .faq-card:hover { border-color: ${C.tealBorder} !important; }

        .sticky-wa {
          position: fixed;
          bottom: 1.5rem;
          right: 1.5rem;
          z-index: 100;
          background: ${C.whatsapp};
          color: #fff;
          border-radius: 999px;
          padding: 0.75rem 1.4rem;
          font-weight: 700;
          font-size: 0.9rem;
          text-decoration: none;
          display: flex;
          align-items: center;
          gap: 0.45rem;
          box-shadow: 0 4px 18px rgba(37,211,102,0.42);
          transition: background 0.2s, transform 0.15s;
          white-space: nowrap;
        }
        .sticky-wa:hover { background: #1da851; transform: translateY(-1px); }
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
        <span style={{ fontSize: "1.2rem", fontWeight: 800, color: C.teal, letterSpacing: "-0.035em" }}>
          RandevuFlow
        </span>
        <a href={CONTACT_URL} className="nav-cta">
          Pilot ba&#351;vurun
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
              Lazer epilasyon ve estetik merkezleri
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
              Kliniğiniz meşgulken WhatsApp&rsquo;tan gelen randevu taleplerini otomatik karşılayın.
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
              RandevuFlow; lazer ve estetik klinikleri için WhatsApp&rsquo;tan gelen müşteri mesajlarını karşılar, hizmet&ndash;tarih&ndash;isim&ndash;telefon bilgisini toplar ve sıcak lead&rsquo;i size bildirir.
            </p>

            <div style={{ marginBottom: "1.5rem" }}>
              <a href={CONTACT_URL} className="btn-wa">
                Pilot ba&#351;vurun
              </a>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem 1rem", fontSize: "0.8rem", color: C.textMuted }}>
              {["7/24 yanıt", "Sıcak müşteri bildirimi", "Google Sheets/CRM kaydı"].map((t) => (
                <span key={t} style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                  <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: C.teal, display: "inline-block", flexShrink: 0 }} />
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* Right - preview cards */}
          <div className="hero-right" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {/* Mini WhatsApp conversation */}
            <div
              className="hero-chat-card"
              style={{
                background: "#fff",
                border: `1px solid ${C.border}`,
                borderRadius: "20px",
                overflow: "hidden",
                boxShadow: "0 8px 32px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04)",
              }}
            >
              <div
                style={{
                  background: C.whatsapp,
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
                  <div style={{ fontWeight: 700, fontSize: "0.82rem", lineHeight: 1.2 }}>Lazer ve Estetik Merkezi</div>
                  <div style={{ fontSize: "0.68rem", opacity: 0.85 }}>cevap veriyor...</div>
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
                  { right: true, text: "Merhaba, lazer fiyat?" },
                  { right: false, text: "Merhaba! Hangi bölge için bilgi almak istersiniz?" },
                  { right: true, text: "Tüm vücut" },
                  { right: false, text: "Harika. Bu hafta hangi gün uygunsunuz?" },
                ].map((m, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: m.right ? "flex-end" : "flex-start" }}>
                    <div
                      style={{
                        background: m.right ? "#dcf8c6" : "#fff",
                        color: C.text,
                        borderRadius: m.right ? "12px 12px 3px 12px" : "12px 12px 12px 3px",
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
                {/* Typing dots */}
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
                      <div key={i} style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#94a3b8" }} />
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
              <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", marginBottom: "0.85rem" }}>
                <span style={{ fontSize: "0.85rem" }}>🔥</span>
                <span style={{ color: C.amber, fontWeight: 700, fontSize: "0.8rem" }}>Yeni sıcak müşteri</span>
                <span style={{ marginLeft: "auto", fontSize: "0.7rem", color: "#475569" }}>2dk önce</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.28rem", fontSize: "0.82rem" }}>
                {([ ["İsim", "Zeynep K."], ["Hizmet", "Tüm vücut lazer"], ["Zaman", "Cumartesi"], ["Skor", "Yüksek"] ] as [string,string][]).map(([k, v]) => (
                  <div key={k} style={{ display: "flex", gap: "0.5rem" }}>
                    <span style={{ color: "#475569", minWidth: "55px" }}>{k}:</span>
                    <span style={{ color: k === "Skor" ? "#34d399" : "#e2e8f0", fontWeight: k === "Skor" ? 700 : 400 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section style={{ background: C.bgAlt, borderTop: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: "860px", margin: "0 auto", padding: "5rem 2.5rem" }}>
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
            Geç cevaplanan her &ldquo;fiyat?&rdquo; mesajı kayıp müşteri olabilir.
          </h2>
          <p style={{ fontSize: "1.05rem", color: C.textMuted, lineHeight: 1.7, marginBottom: "2.25rem", maxWidth: "560px" }}>
            Siz işlemdeyken müşteri beklemez. Cevap gecikirse başka merkeze yazar. RandevuFlow, özellikle akşam, hafta sonu ve yoğun saatlerde gelen talepleri kaçırmamanız için çalışır.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", maxWidth: "500px" }}>
            {[
              "Geç cevaplanan DM'ler",
              "Takipsiz kalan fiyat soruları",
              "Yoğun saatlerde unutulan randevu talepleri",
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
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
                  <circle cx="7" cy="7" r="7" fill="#fef2f2" />
                  <path d="M4.5 4.5l5 5M9.5 4.5l-5 5" stroke={C.red} strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                {p}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section>
        <div style={{ maxWidth: "960px", margin: "0 auto", padding: "5rem 2.5rem" }}>
          <h2
            style={{
              fontSize: "clamp(1.55rem, 3.2vw, 2.05rem)",
              fontWeight: 800,
              letterSpacing: "-0.025em",
              marginBottom: "0.65rem",
              color: C.text,
            }}
          >
            RandevuFlow nasıl çalışır?
          </h2>
          <p style={{ fontSize: "1rem", color: C.textMuted, lineHeight: 1.65, maxWidth: "500px" }}>
            Siz işlemdeyken bile.
          </p>
          <div className="how-it-works-grid">
            {[
              {
                n: "01",
                title: "Müşteri WhatsApp'tan yazar",
                desc: "WhatsApp veya Instagram'dan fiyat sorusu, randevu talebi veya bilgi isteği gelir.",
              },
              {
                n: "02",
                title: "RandevuFlow gerekli bilgileri toplar",
                desc: "Hizmet, tarih, isim ve telefon bilgisini otomatik toplar. Bilmediği şeyleri sormaz.",
              },
              {
                n: "03",
                title: "Sıcak lead işletmeye bildirilir",
                desc: "Hazır randevu talebi, müşteri özeti ve önerilen aksiyon işletmeye iletilir.",
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
                <div style={{ fontWeight: 700, fontSize: "1rem", marginBottom: "0.45rem", color: C.text }}>
                  {step.title}
                </div>
                <div style={{ fontSize: "0.9rem", color: C.textMuted, lineHeight: 1.65 }}>
                  {step.desc}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Demo Conversation */}
      <section id="demo" style={{ background: C.bgAlt, borderTop: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: "620px", margin: "0 auto", padding: "5rem 2.5rem", textAlign: "center" }}>
          <h2
            style={{
              fontSize: "clamp(1.55rem, 3.2vw, 2.05rem)",
              fontWeight: 800,
              letterSpacing: "-0.025em",
              marginBottom: "0.65rem",
              color: C.text,
            }}
          >
            Gerçek bir fiyat sorusu nasıl randevuya dönüşür?
          </h2>
          <p style={{ fontSize: "1rem", color: C.textMuted, lineHeight: 1.65, marginBottom: "2.5rem", maxWidth: "460px", margin: "0 auto 2.5rem" }}>
            Aşağıdaki konuşma tamamen otomatik gerçekleşir. Siz işlemdeyken bile.
          </p>

          <div
            style={{
              background: "#fff",
              border: `1px solid ${C.border}`,
              borderRadius: "20px",
              overflow: "hidden",
              boxShadow: "0 4px 24px rgba(0,0,0,0.07), 0 1px 4px rgba(0,0,0,0.04)",
              textAlign: "left",
            }}
          >
            <div
              style={{
                background: C.whatsapp,
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
                <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>Lazer ve Estetik Merkezi</div>
                <div style={{ fontSize: "0.72rem", opacity: 0.85 }}>cevap veriyor...</div>
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
                  <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: isCustomer ? "flex-end" : "flex-start" }}>
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
                        borderRadius: isCustomer ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
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

          {/* Notification card */}
          <div
            style={{
              background: C.bgDark,
              color: "#e2e8f0",
              borderRadius: "16px",
              padding: "1.35rem 1.5rem",
              marginTop: "1.25rem",
              fontSize: "0.9rem",
              lineHeight: 1.75,
              boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
              textAlign: "left",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: "0.85rem", color: C.amber, display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <span>🔥</span>
              <span>Yeni sıcak müşteri</span>
            </div>
            {notifRows.map(([k, v]) => (
              <div key={k} style={{ display: "flex", gap: "0.5rem", lineHeight: 1.8 }}>
                <span style={{ color: "#475569", minWidth: "110px", fontSize: "0.85rem" }}>{k}:</span>
                <span style={{ fontWeight: k === "Öneri" ? 700 : 400, color: k === "Lead skoru" ? "#34d399" : "#e2e8f0" }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="fiyat">
        <div style={{ maxWidth: "1060px", margin: "0 auto", padding: "5rem 2.5rem" }}>
          <h2
            style={{
              fontSize: "clamp(1.55rem, 3.2vw, 2.05rem)",
              fontWeight: 800,
              letterSpacing: "-0.025em",
              marginBottom: "0.65rem",
              color: C.text,
            }}
          >
            İlk üç klinikten biriyle çalışmak istiyoruz.
          </h2>
          <p style={{ fontSize: "1rem", color: C.textMuted, lineHeight: 1.65, maxWidth: "500px" }}>
            Sistemi gerçek akışınızda kurarız. 7 gün içinde sonuçları birlikte değerlendiririz.
          </p>

          <div className="pricing-grid">
            {/* Pilot - Featured */}
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
                İlk 3 işletmeye özel
              </div>
              <div style={{ fontWeight: 800, fontSize: "1.2rem", marginBottom: "0.3rem", color: "#f1f5f9" }}>
                Pilot Paket
              </div>
              <div style={{ fontSize: "0.9rem", color: "#475569", marginBottom: "1.5rem" }}>
                Sistemi deneyin, sonuçları görün.
              </div>
              <div style={{ marginBottom: "0.5rem" }}>
                <div style={{ fontSize: "0.73rem", color: "#475569", fontWeight: 500, marginBottom: "0.15rem" }}>Kurulum</div>
                <div style={{ fontWeight: 800, fontSize: "1.8rem", color: "#f1f5f9", letterSpacing: "-0.03em" }}>3.500 TL</div>
              </div>
              <div>
                <div style={{ fontSize: "0.73rem", color: "#475569", fontWeight: 500, marginBottom: "0.15rem" }}>Aylık</div>
                <div style={{ fontWeight: 800, fontSize: "1.8rem", color: "#f1f5f9", letterSpacing: "-0.03em" }}>3.500 TL</div>
              </div>
              <div style={{ height: "1px", background: "rgba(255,255,255,0.08)", margin: "1.25rem 0" }} />
              <CheckList items={pilotFeatures} white />
              <div style={{ marginTop: "auto" }}>
                <a href={CONTACT_URL} className="btn-pilot-cta">
                  Başlamak istiyorum
                </a>
              </div>
            </div>

            {/* Standart */}
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
              <div style={{ fontWeight: 800, fontSize: "1.2rem", marginBottom: "0.3rem", color: C.text }}>
                Standart Paket
              </div>
              <div style={{ fontSize: "0.9rem", color: C.textMuted, marginBottom: "1.5rem" }}>
                Tam özellikli, ölçeklenebilir.
              </div>
              <div style={{ marginBottom: "0.5rem" }}>
                <div style={{ fontSize: "0.73rem", color: C.textMuted, fontWeight: 500, marginBottom: "0.15rem" }}>Kurulum</div>
                <div style={{ fontWeight: 800, fontSize: "1.8rem", color: C.text, letterSpacing: "-0.03em" }}>10.000 TL</div>
              </div>
              <div>
                <div style={{ fontSize: "0.73rem", color: C.textMuted, fontWeight: 500, marginBottom: "0.15rem" }}>Aylık</div>
                <div style={{ fontWeight: 800, fontSize: "1.8rem", color: C.text, letterSpacing: "-0.03em" }}>7.500 TL</div>
              </div>
              <div style={{ height: "1px", background: C.border, margin: "1.25rem 0" }} />
              <CheckList items={standartFeatures} />
              <div style={{ marginTop: "auto" }}>
                <a href={CONTACT_URL} className="btn-outline-cta">
                  Bilgi al
                </a>
              </div>
            </div>

            {/* Klinik */}
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
              <div style={{ fontWeight: 800, fontSize: "1.2rem", marginBottom: "0.3rem", color: C.text }}>
                Klinik Paket
              </div>
              <div style={{ fontSize: "0.9rem", color: C.textMuted, marginBottom: "1.5rem" }}>
                Çok hizmetli klinikler için.
              </div>
              <div>
                <div style={{ fontSize: "0.73rem", color: C.textMuted, fontWeight: 500, marginBottom: "0.15rem" }}>Fiyatlandırma</div>
                <div style={{ fontWeight: 800, fontSize: "1.8rem", color: C.text, letterSpacing: "-0.03em" }}>Özel teklif</div>
              </div>
              <div style={{ height: "1px", background: C.border, margin: "1.25rem 0" }} />
              <CheckList items={klinikFeatures} />
              <div style={{ marginTop: "auto" }}>
                <a href={CONTACT_URL} className="btn-outline-cta">
                  Teklif isteyin
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
          İlk pilot işletmelerle birebir kurulum ve manuel kalite kontrol.
        </div>
      </div>

      {/* FAQ */}
      <section style={{ background: C.bgAlt, borderTop: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: "720px", margin: "0 auto", padding: "5rem 2.5rem" }}>
          <h2
            style={{
              fontSize: "clamp(1.55rem, 3.2vw, 2.05rem)",
              fontWeight: 800,
              letterSpacing: "-0.025em",
              marginBottom: "2rem",
              color: C.text,
            }}
          >
            Sık sorulan sorular
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
                <div style={{ fontWeight: 700, fontSize: "0.975rem", marginBottom: "0.55rem", color: C.text, lineHeight: 1.45 }}>
                  {faq.q}
                </div>
                <div style={{ fontSize: "0.9rem", color: C.textMuted, lineHeight: 1.65 }}>
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
        <div style={{ maxWidth: "640px", margin: "0 auto", padding: "5.5rem 2.5rem", textAlign: "center" }}>
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
            Merkeziniz için ücretsiz kurulum demosu yapalım.
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
            Hangi hizmetleri sunduğunuzu anlatın. Sistemi size özel yapılandıralım. Birlikte test edelim.
          </p>
          <a href={CONTACT_URL} className="btn-wa-lg">
            Pilot ba&#351;vurun
          </a>
        </div>
      </section>

      {/* Uyumluluk notu */}
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
          RandevuFlow, müşteriniz işletmenize ulaştıktan sonra bilgi toplama ve takip sürecini düzenler. Toplu izinsiz mesaj gönderimi için tasarlanmamıştır. Müşteri bilgileri KVKK kapsamında işlenir.
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
          <strong style={{ color: "#e2e8f0" }}>RandevuFlow</strong> - Lazer epilasyon ve estetik merkezleri için AI müşteri asistanı.
        </div>
        <div style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}>
          WhatsApp - Instagram - Google Sheets - 7/24 otomatik yanıt
        </div>
      </footer>

      {/* Sticky WhatsApp */}
      <a href={CONTACT_URL} className="sticky-wa">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.126 1.533 5.857L.054 23.454a.5.5 0 00.492.6h.001l5.817-1.524A11.95 11.95 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22a9.95 9.95 0 01-5.07-1.382l-.36-.214-3.742.981.998-3.648-.235-.374A9.95 9.95 0 012 12C2 6.478 6.478 2 12 2s10 4.478 10 10-4.478 10-10 10z" />
        </svg>
        <span>Pilot başvurun</span>
      </a>
    </div>
  );
}
