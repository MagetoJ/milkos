import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";
import NativeGoogleOAuth from '@/components/native/native-google-oauth';

export const metadata: Metadata = {
  title: "MilkOS",
  description: "Dairy Collection & Management System",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NativeGoogleOAuth />
        {children}
      </body>
    </html>
  );
}
