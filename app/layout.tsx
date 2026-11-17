import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";

export const metadata: Metadata = {
  title: "MilkOS",
  description: "Dairy Collection & Management System",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isCapacitor = process.env.NEXT_PUBLIC_IS_CAPACITOR === "true";

  return (
    <html lang="en">
      <body>
        {children}
        {!isCapacitor && <Analytics />}
      </body>
    </html>
  );
}
