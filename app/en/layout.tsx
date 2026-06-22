import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "RandevuFlow — AI Customer Assistant for Laser & Aesthetic Clinics",
  description:
    "Turn WhatsApp price inquiries into appointment requests. AI-powered customer assistant for laser hair removal and aesthetic clinics.",
};

export default function EnLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
