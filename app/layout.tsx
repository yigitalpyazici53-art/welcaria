import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "RandevuFlow — Akıllı Müşteri Karşılama Sistemi",
  description: "WhatsApp ve Instagram'dan gelen müşterileri randevu talebine çevirin. Güzellik salonları, estetik merkezleri ve servis işletmeleri için.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="tr">
      <body style={{ margin: 0, padding: 0, fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
