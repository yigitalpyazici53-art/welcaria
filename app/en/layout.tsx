import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Welcaria — WhatsApp Lead Response System for Premium Clinics",
  description:
    "Turn high-intent WhatsApp inquiries into qualified patient leads. Welcaria helps premium aesthetic clinics respond instantly, qualify each inquiry, and alert the team.",
};

export default function EnLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
