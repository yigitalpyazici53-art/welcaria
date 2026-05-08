import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "RapidFlow Plumbing — AI Receptionist",
  description: "Missed-call SMS text-back system",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
