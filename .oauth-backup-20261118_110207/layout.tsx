import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";
import { CapacitorAuthListener } from '@/components/capacitor-auth-listener';

export const metadata: Metadata = {
  title: "MilkOS",
  description: "Dairy Collection & Management System",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <CapacitorAuthListener />
        {children}
      </body>
    </html>
  );
}
