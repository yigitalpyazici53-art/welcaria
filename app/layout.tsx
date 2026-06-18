import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "RandevuFlow — Lazer Epilasyon ve Estetik Merkezleri için AI Randevu Asistanı",
  description: "Instagram ve WhatsApp mesajlarınızı otomatik olarak dolu randevulara çevirin. Lazer epilasyon ve estetik merkezleri için 7/24 AI müşteri asistanı.",
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
