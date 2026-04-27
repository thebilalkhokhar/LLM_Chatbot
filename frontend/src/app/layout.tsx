import type { Metadata } from "next";

import { AuthProvider } from "@/context/AuthContext";

import "./globals.css";

export const metadata: Metadata = {
  title: "AI Gateway",
  description: "A premium chat interface for the AI Gateway.",
  // Favicons are emitted automatically from `app/icon.tsx` and
  // `app/apple-icon.tsx` — no manual `icons` entry needed.
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
