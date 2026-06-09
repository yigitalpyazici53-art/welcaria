const colors = {
  bg: "#ffffff",
  bgAlt: "#f8fafc",
  bgDark: "#0f172a",
  primary: "#2563eb",
  primaryDark: "#1d4ed8",
  indigo: "#6366f1",
  text: "#1e293b",
  textMuted: "#64748b",
  border: "#e2e8f0",
  green: "#10b981",
  amber: "#f59e0b",
};

const styles = {
  page: {
    background: colors.bg,
    color: colors.text,
    minHeight: "100vh",
  } as React.CSSProperties,

  nav: {
    padding: "1rem 2rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottom: `1px solid ${colors.border}`,
    background: colors.bg,
    position: "sticky",
    top: 0,
    zIndex: 10,
  } as React.CSSProperties,

  logo: {
    fontSize: "1.25rem",
    fontWeight: 700,
    color: colors.primary,
    letterSpacing: "-0.02em",
  } as React.CSSProperties,

  navCta: {
    background: colors.primary,
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    padding: "0.5rem 1.25rem",
    fontSize: "0.875rem",
    fontWeight: 600,
    cursor: "pointer",
    textDecoration: "none",
    display: "inline-block",
  } as React.CSSProperties,

  hero: {
    maxWidth: "760px",
    margin: "0 auto",
    padding: "5rem 2rem 4rem",
    textAlign: "center",
  } as React.CSSProperties,

  badge: {
    display: "inline-block",
    background: "#eff6ff",
    color: colors.primary,
    fontSize: "0.8rem",
    fontWeight: 600,
    padding: "0.3rem 0.9rem",
    borderRadius: "999px",
    marginBottom: "1.5rem",
    border: `1px solid #bfdbfe`,
  } as React.CSSProperties,

  badgeAmber: {
    display: "inline-block",
    background: "#fffbeb",
    color: "#92400e",
    fontSize: "0.8rem",
    fontWeight: 600,
    padding: "0.3rem 0.9rem",
    borderRadius: "999px",
    marginBottom: "1.5rem",
    border: `1px solid #fcd34d`,
  } as React.CSSProperties,

  h1: {
    fontSize: "clamp(2rem, 5vw, 3rem)",
    fontWeight: 800,
    lineHeight: 1.15,
    color: colors.text,
    marginBottom: "1.25rem",
    letterSpacing: "-0.03em",
  } as React.CSSProperties,

  subheadline: {
    fontSize: "1.125rem",
    color: colors.textMuted,
    lineHeight: 1.65,
    maxWidth: "600px",
    margin: "0 auto 2.5rem",
  } as React.CSSProperties,

  problemLine: {
    fontSize: "1rem",
    color: colors.text,
    lineHeight: 1.65,
    maxWidth: "580px",
    margin: "0 auto 2.5rem",
    background: "#f0fdf4",
    border: `1px solid #bbf7d0`,
    borderRadius: "10px",
    padding: "0.85rem 1.25rem",
  } as React.CSSProperties,

  ctaRow: {
    display: "flex",
    gap: "1rem",
    justifyContent: "center",
    flexWrap: "wrap" as const,
    marginBottom: "1rem",
  } as React.CSSProperties,

  btnPrimary: {
    background: colors.primary,
    color: "#fff",
    border: "none",
    borderRadius: "10px",
    padding: "0.85rem 2rem",
    fontSize: "1rem",
    fontWeight: 700,
    cursor: "pointer",
    textDecoration: "none",
    display: "inline-block",
  } as React.CSSProperties,

  btnSecondary: {
    background: "transparent",
    color: colors.primary,
    border: `2px solid ${colors.primary}`,
    borderRadius: "10px",
    padding: "0.85rem 2rem",
    fontSize: "1rem",
    fontWeight: 700,
    cursor: "pointer",
    textDecoration: "none",
    display: "inline-block",
  } as React.CSSProperties,

  section: {
    maxWidth: "900px",
    margin: "0 auto",
    padding: "4rem 2rem",
  } as React.CSSProperties,

  sectionAlt: {
    background: colors.bgAlt,
  } as React.CSSProperties,

  sectionDark: {
    background: colors.bgDark,
    color: "#fff",
  } as React.CSSProperties,

  sectionTitle: {
    fontSize: "1.75rem",
    fontWeight: 800,
    marginBottom: "0.5rem",
    letterSpacing: "-0.02em",
  } as React.CSSProperties,

  sectionSubtitle: {
    color: colors.textMuted,
    fontSize: "1rem",
    marginBottom: "2.5rem",
  } as React.CSSProperties,

  card: {
    background: "#fff",
    border: `1px solid ${colors.border}`,
    borderRadius: "14px",
    padding: "1.5rem",
  } as React.CSSProperties,

  metricCard: {
    background: "#fff",
    border: `1px solid ${colors.border}`,
    borderRadius: "14px",
    padding: "1.75rem 1.5rem",
    textAlign: "center" as const,
  } as React.CSSProperties,

  grid2: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "1.25rem",
  } as React.CSSProperties,

  grid3: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "1.25rem",
  } as React.CSSProperties,

  statusCard: {
    background: "#fff",
    border: `1px solid ${colors.border}`,
    borderRadius: "14px",
    padding: "1.25rem 1.75rem",
    maxWidth: "540px",
    margin: "0 auto",
    boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
  } as React.CSSProperties,

  dot: (color: string) => ({
    width: "10px",
    height: "10px",
    borderRadius: "50%",
    background: color,
    flexShrink: 0,
    display: "inline-block",
    marginRight: "0.5rem",
    verticalAlign: "middle",
  }) as React.CSSProperties,

  stepNumber: {
    width: "36px",
    height: "36px",
    borderRadius: "50%",
    background: "#eff6ff",
    color: colors.primary,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    fontSize: "0.875rem",
    flexShrink: 0,
  } as React.CSSProperties,

  tag: {
    display: "inline-block",
    background: "#eff6ff",
    color: colors.primary,
    border: `1px solid #bfdbfe`,
    borderRadius: "8px",
    padding: "0.35rem 0.85rem",
    fontSize: "0.85rem",
    fontWeight: 600,
    margin: "0.25rem",
  } as React.CSSProperties,

  notificationBox: {
    background: "#0f172a",
    color: "#e2e8f0",
    borderRadius: "14px",
    padding: "1.5rem",
    fontFamily: "monospace",
    fontSize: "0.9rem",
    lineHeight: 1.7,
  } as React.CSSProperties,

  highlight: (color: string) => ({
    color,
    fontWeight: 700,
  }) as React.CSSProperties,

  footer: {
    background: colors.bgDark,
    color: "#94a3b8",
    textAlign: "center" as const,
    padding: "2rem",
    fontSize: "0.875rem",
  } as React.CSSProperties,

  chatBubbleCustomer: {
    background: colors.primary,
    color: "#fff",
    borderRadius: "18px 18px 4px 18px",
    padding: "0.65rem 1rem",
    fontSize: "0.9rem",
    maxWidth: "80%",
    alignSelf: "flex-end",
    marginLeft: "auto",
  } as React.CSSProperties,

  chatBubbleAssistant: {
    background: "#f1f5f9",
    color: colors.text,
    borderRadius: "18px 18px 18px 4px",
    padding: "0.65rem 1rem",
    fontSize: "0.9rem",
    maxWidth: "80%",
  } as React.CSSProperties,

  chatLabel: {
    fontSize: "0.72rem",
    fontWeight: 600,
    color: colors.textMuted,
    marginBottom: "0.25rem",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
  } as React.CSSProperties,

  ownerAlert: {
    background: "#fffbeb",
    border: `1px solid #fcd34d`,
    borderRadius: "10px",
    padding: "0.75rem 1rem",
    fontSize: "0.875rem",
    fontWeight: 600,
    color: "#92400e",
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    marginTop: "0.5rem",
  } as React.CSSProperties,
};

const industries = [
  { icon: "✦", title: "Güzellik & Kuaför Salonları", desc: "Saç, tırnak, manikür ve pedikür randevuları" },
  { icon: "✦", title: "Estetik & Medikal Merkezler", desc: "Botoks, dolgu, lazer ve cilt bakım klinikleri" },
  { icon: "✦", title: "Diş Klinikleri", desc: "Kontrol, tedavi ve estetik diş randevuları" },
  { icon: "✦", title: "Oto Detay & Bakım", desc: "Araç yıkama, detay ve bakım hizmetleri" },
  { icon: "✦", title: "SPA & Masaj Merkezleri", desc: "Masaj, terapi ve wellness randevuları" },
  { icon: "✦", title: "Özel Hizmet Sağlayıcılar", desc: "Evde hizmet, ziyaret ve serbest profesyoneller" },
];

const steps = [
  {
    n: "1",
    title: "Müşteri Mesaj Atar",
    desc: "WhatsApp veya Instagram'dan gelen müşteri, sizin numaranıza veya hesabınıza mesaj yazar.",
  },
  {
    n: "2",
    title: "Asistan Karşılar",
    desc: "Sistem müşteriyi sıcak ve profesyonel bir şekilde karşılar; adını, hizmet talebini ve tercihlerini tek tek sorar.",
  },
  {
    n: "3",
    title: "Bilgiler Toplanır",
    desc: "Ad, hizmet, tercih edilen tarih/saat, konum ve aciliyet otomatik olarak kayıt altına alınır.",
  },
  {
    n: "4",
    title: "Ekibe Bildirim",
    desc: "Tüm bilgiler Google Sheets'e işlenir ve işletme sahibine anlık SMS bildirimi gönderilir.",
  },
];

const collectedFields = [
  "Ad / Soyad",
  "Telefon Numarası",
  "İstenen Hizmet",
  "Tercih Edilen Tarih",
  "Tercih Edilen Saat",
  "Konum / Şube Tercihi",
  "Aciliyet Seviyesi",
  "Kanal (WhatsApp / SMS)",
  "Lead Skoru (Sıcak / Ilık / Soğuk)",
  "Ek Not / Müşteri Yorumu",
];

const metrics = [
  {
    icon: "⚡",
    title: "Anında cevap",
    desc: "Müşteri yazdığı anda karşılanır. Siz müsait olmadığınızda bile hiçbir müşteri cevapsız kalmaz.",
  },
  {
    icon: "📋",
    title: "Daha düzenli takip",
    desc: "Tüm talepler tek tabloda toplanır. Kim ne istedi, ne zaman yazdı — hepsi gözünüzün önünde.",
  },
  {
    icon: "🔔",
    title: "Sıcak lead bildirimi",
    desc: "Randevuya yakın müşteriler ekibe anında iletilir. En önemli leadleri kaçırmazsınız.",
  },
];

const PILOT_EMAIL = "yigitalpyazici53@gmail.com";

export default function Home() {
  return (
    <div style={styles.page}>
      {/* ── Nav ── */}
      <nav style={styles.nav}>
        <span style={styles.logo}>RandevuFlow</span>
        <a
          href={`mailto:${PILOT_EMAIL}?subject=RandevuFlow%20Pilot%20Ba%C5%9Fvurusu`}
          style={styles.navCta}
        >
          Pilot Başvurusu
        </a>
      </nav>

      {/* ── Hero ── */}
      <div style={styles.hero}>
        <span style={styles.badge}>Türkiye&rsquo;deki Hizmet İşletmeleri İçin</span>
        <h1 style={styles.h1}>
          WhatsApp ve Instagram&rsquo;dan gelen müşterileri randevu talebine çevirin.
        </h1>
        <p style={styles.subheadline}>
          Güzellik salonları, estetik merkezleri, diş klinikleri ve oto servisler için
          akıllı müşteri karşılama, bilgi toplama ve lead takip sistemi.
        </p>
        <p style={styles.problemLine}>
          Geç cevap yüzünden kaçan müşterileri otomatik karşılayın, bilgilerini toplayın
          ve ekibinize hazır randevu talebi olarak iletin.
        </p>
        <div style={styles.ctaRow}>
          <a
            href={`mailto:${PILOT_EMAIL}?subject=RandevuFlow%20Pilot%20Ba%C5%9Fvurusu`}
            style={styles.btnPrimary}
          >
            Pilot işletme olmak istiyorum
          </a>
          <a href="#demo" style={styles.btnSecondary}>Demo akışını gör</a>
        </div>

        {/* Status card — no internal API paths shown to visitors */}
        <div style={{ ...styles.statusCard, marginTop: "2.5rem" }}>
          <div style={{ display: "flex", flexDirection: "column" as const, gap: "0.4rem" }}>
            <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>
              <span style={styles.dot(colors.green)} />
              Sistem durumu: Aktif
            </div>
            <div style={{ fontSize: "0.82rem", color: colors.textMuted }}>
              Kanallar: WhatsApp / SMS / Instagram yönlendirme
            </div>
            <div style={{ fontSize: "0.82rem", color: colors.textMuted }}>
              Kayıt: Google Sheets / CRM
            </div>
          </div>
        </div>
      </div>

      {/* ── Neden değerli? ── */}
      <div style={styles.sectionAlt}>
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Neden işletmeler için değerli?</h2>
          <p style={styles.sectionSubtitle}>
            Rakipleriniz cevap vermeden önce siz orada olun.
          </p>
          <div style={styles.grid3}>
            {metrics.map((m) => (
              <div key={m.title} style={styles.metricCard}>
                <div style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>{m.icon}</div>
                <div style={{ fontWeight: 800, fontSize: "1.1rem", marginBottom: "0.5rem" }}>
                  {m.title}
                </div>
                <div style={{ fontSize: "0.875rem", color: colors.textMuted, lineHeight: 1.6 }}>
                  {m.desc}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Kimler için? ── */}
      <div>
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Kimler için?</h2>
          <p style={styles.sectionSubtitle}>
            WhatsApp ve Instagram&rsquo;dan müşteri alan her hizmet işletmesi için uygundur.
          </p>
          <div style={styles.grid3}>
            {industries.map((item) => (
              <div key={item.title} style={styles.card}>
                <div style={{ fontSize: "1.25rem", color: colors.primary, marginBottom: "0.5rem" }}>
                  {item.icon}
                </div>
                <div style={{ fontWeight: 700, marginBottom: "0.35rem" }}>{item.title}</div>
                <div style={{ fontSize: "0.875rem", color: colors.textMuted }}>{item.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Demo konuşma örneği ── */}
      <div id="demo" style={styles.sectionAlt}>
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Demo konuşma örneği</h2>
          <p style={styles.sectionSubtitle}>
            Gerçek bir müşteri etkileşimi nasıl görünür? İşte canlı bir örnek.
          </p>
          <div
            style={{
              ...styles.card,
              maxWidth: "520px",
              margin: "0 auto",
              display: "flex",
              flexDirection: "column" as const,
              gap: "1rem",
            }}
          >
            {/* Customer message 1 */}
            <div>
              <div style={{ ...styles.chatLabel, textAlign: "right" }}>Müşteri</div>
              <div style={styles.chatBubbleCustomer}>
                Merhaba lazer epilasyon fiyat alabilir miyim?
              </div>
            </div>

            {/* Assistant response 1 */}
            <div>
              <div style={styles.chatLabel}>RandevuFlow Asistanı</div>
              <div style={styles.chatBubbleAssistant}>
                Merhaba, yardımcı olalım. Hangi bölge için bilgi almak istersiniz?
              </div>
            </div>

            {/* Customer message 2 */}
            <div>
              <div style={{ ...styles.chatLabel, textAlign: "right" }}>Müşteri</div>
              <div style={styles.chatBubbleCustomer}>
                Tüm vücut ve cumartesi uygun olur.
              </div>
            </div>

            {/* Assistant response 2 */}
            <div>
              <div style={styles.chatLabel}>RandevuFlow Asistanı</div>
              <div style={styles.chatBubbleAssistant}>
                Harika. Adınızı ve size ulaşabileceğimiz telefon numarasını paylaşır mısınız?
              </div>
            </div>

            {/* Owner alert */}
            <div style={styles.ownerAlert}>
              <span>🔔</span>
              <span>
                <strong>İşletme sahibi bildirimi:</strong> Yeni sıcak lead — Lazer epilasyon / Cumartesi /{" "}
                <span style={{ color: "#b45309" }}>HOT</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Nasıl çalışır? ── */}
      <div id="nasil-calisir">
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Nasıl çalışır?</h2>
          <p style={styles.sectionSubtitle}>
            Teknik karmaşayla uğraşmadan işletmenizin mevcut müşteri akışına bağlanır.
          </p>
          <div style={{ display: "flex", flexDirection: "column" as const, gap: "1.25rem" }}>
            {steps.map((step) => (
              <div
                key={step.n}
                style={{ ...styles.card, display: "flex", gap: "1.25rem", alignItems: "flex-start" }}
              >
                <div style={styles.stepNumber}>{step.n}</div>
                <div>
                  <div style={{ fontWeight: 700, marginBottom: "0.25rem" }}>{step.title}</div>
                  <div style={{ fontSize: "0.9rem", color: colors.textMuted }}>{step.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Toplanan bilgiler ── */}
      <div style={styles.sectionAlt}>
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Toplanan bilgiler</h2>
          <p style={styles.sectionSubtitle}>
            Her konuşmadan otomatik olarak çıkarılan lead verileri.
          </p>
          <div>
            {collectedFields.map((field) => (
              <span key={field} style={styles.tag}>
                {field}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Bildirim örneği ── */}
      <div>
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>İşletmeye gelen bildirim örneği</h2>
          <p style={styles.sectionSubtitle}>
            Müşteri konuşma tamamlandığında işletme sahibine şu formatta SMS gider.
          </p>
          <div style={styles.notificationBox}>
            <div>
              <span style={styles.highlight("#94a3b8")}>[RF] </span>
              <span style={styles.highlight("#34d399")}>+905xx xxx xx xx</span>
              <span style={{ color: "#f59e0b", fontWeight: 700 }}> HOT</span>
            </div>
            <div style={{ marginTop: "0.5rem" }}>
              <span style={styles.highlight("#93c5fd")}>Hizmet: </span>
              kalıcı manikür
            </div>
            <div>
              <span style={styles.highlight("#93c5fd")}>Tarih: </span>
              yarın öğleden sonra
            </div>
            <div>
              <span style={styles.highlight("#93c5fd")}>Ad: </span>
              Ayşe
            </div>
            <div style={{ marginTop: "0.75rem", color: "#64748b", fontSize: "0.8rem" }}>
              → Sheets&rsquo;e kaydedildi · Durum: in_progress
            </div>
          </div>
          <div style={{ marginTop: "1.25rem", display: "flex", gap: "1rem", flexWrap: "wrap" as const }}>
            <div style={{ ...styles.card, flex: 1, minWidth: "220px" }}>
              <div style={{ fontWeight: 700, marginBottom: "0.25rem" }}>Google Sheets</div>
              <div style={{ fontSize: "0.875rem", color: colors.textMuted }}>
                Tüm leadlar otomatik olarak spreadsheet&rsquo;e işlenir. Ekip gerçek zamanlı takip eder.
              </div>
            </div>
            <div style={{ ...styles.card, flex: 1, minWidth: "220px" }}>
              <div style={{ fontWeight: 700, marginBottom: "0.25rem" }}>SMS Bildirimi</div>
              <div style={{ fontSize: "0.875rem", color: colors.textMuted }}>
                İşletme sahibi her yeni sıcak lead için anında SMS bildirimi alır.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Pilot teklifi ── */}
      <div id="pilot" style={styles.sectionAlt}>
        <div style={{ ...styles.section, textAlign: "center" }}>
          <span style={styles.badgeAmber}>Sınırlı Kontenjan — İlk 10 İşletme</span>
          <h2 style={{ ...styles.sectionTitle, marginTop: "0.5rem" }}>
            İlk 10 pilot işletme için özel kurulum teklifi
          </h2>
          <p style={{ ...styles.subheadline, margin: "0 auto 2rem" }}>
            Sistemi gerçek müşteri akışınızda test edin.
            Kurulum, kişiselleştirme ve ilk optimizasyon bizden.
          </p>
          <div style={{ ...styles.card, maxWidth: "520px", margin: "0 auto 2rem", textAlign: "left" }}>
            {[
              "WhatsApp veya SMS entegrasyonu",
              "Türkçe AI asistan kişiselleştirme",
              "Google Sheets lead tablosu",
              "İşletme sahibine SMS bildirimleri",
              "Pilot süresince tam destek, sonrasında aylık sabit ücret",
            ].map((item) => (
              <div
                key={item}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  padding: "0.6rem 0",
                  borderBottom: `1px solid ${colors.border}`,
                }}
              >
                <span style={{ color: colors.green, fontWeight: 700 }}>✓</span>
                <span style={{ fontSize: "0.95rem" }}>{item}</span>
              </div>
            ))}
          </div>
          <a
            href={`mailto:${PILOT_EMAIL}?subject=RandevuFlow%20Pilot%20Ba%C5%9Fvurusu`}
            style={{ ...styles.btnPrimary, fontSize: "1.05rem", padding: "1rem 2.5rem" }}
          >
            Pilot işletme olmak istiyorum
          </a>
        </div>
      </div>

      {/* ── CTA ── */}
      <div style={{ background: colors.bgDark }}>
        <div style={{ ...styles.section, textAlign: "center" }}>
          <h2 style={{ ...styles.sectionTitle, color: "#fff", marginBottom: "0.75rem" }}>
            Hazır mısınız?
          </h2>
          <p style={{ color: "#94a3b8", fontSize: "1rem", marginBottom: "2rem" }}>
            WhatsApp ve Instagram&rsquo;dan gelen her müşteriyi doğru şekilde karşılayın.
          </p>
          <a
            href={`mailto:${PILOT_EMAIL}?subject=RandevuFlow%20Pilot%20Ba%C5%9Fvurusu`}
            style={styles.btnPrimary}
          >
            Pilot işletme olmak istiyorum
          </a>
        </div>
      </div>

      {/* ── Uyumluluk notu ── */}
      <div style={{ background: "#f8fafc", borderTop: `1px solid ${colors.border}` }}>
        <div
          style={{
            maxWidth: "760px",
            margin: "0 auto",
            padding: "1.5rem 2rem",
            textAlign: "center" as const,
            fontSize: "0.82rem",
            color: colors.textMuted,
            lineHeight: 1.6,
          }}
        >
          RandevuFlow, müşteriniz işletmenize ulaştıktan sonra bilgi toplama ve takip sürecini düzenler.
          Toplu izinsiz mesaj gönderimi için tasarlanmamıştır.
        </div>
      </div>

      {/* ── Footer ── */}
      <footer style={styles.footer}>
        <div>
          <strong style={{ color: "#e2e8f0" }}>RandevuFlow</strong> — Türkiye&rsquo;deki hizmet işletmeleri için akıllı müşteri karşılama sistemi.
        </div>
        <div style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}>
          WhatsApp · Instagram · SMS entegrasyonu · Google Sheets · Gerçek zamanlı bildirim
        </div>
      </footer>
    </div>
  );
}
