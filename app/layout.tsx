import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";
import NativeRouterBridge from '@/components/native/native-router-bridge';
import NativeGoogleOAuth from '@/components/native/native-google-oauth';
import NativeApiOrigin from '@/components/native/native-api-origin';

export const metadata: Metadata = {
  title: "MilkOS",
  description: "Dairy Collection & Management System",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NativeApiOrigin />
        <NativeRouterBridge />
        <NativeGoogleOAuth />
        {children}
      </body>
    </html>
  );
}
