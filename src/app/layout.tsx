import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";

export const metadata: Metadata = {
  title: "MilkOS",
  description: "Offline-first milk collection operating system",
};

// Check if we are on Vercel
const isVercel = process.env.NEXT_PUBLIC_VERCEL_ENV !== undefined;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        {isVercel && <Analytics />}
      </body>
    </html>
  );
}
