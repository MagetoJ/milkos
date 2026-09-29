"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearSession, getSession } from "@/lib/auth";

export default function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);

  // Step 1: Confirm client mount to prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Step 2: Run auth checks only after mount & router initialization
  useEffect(() => {
    if (!mounted) return;

    const session = getSession();

    if (!session || session.role !== "SUPER_ADMIN") {
      clearSession();
      router.replace("/login");
      return;
    }

    let isCancelled = false;

    async function verify() {
      try {
        const res = await fetch("/api/v1/auth/me", {
          headers: { Authorization: `Bearer ${session.token}` },
        });

        if (isCancelled) return;

        if (!res.ok) {
          clearSession();
          router.replace("/login");
        } else {
          setIsAuthorized(true);
        }
      } catch {
        if (!isCancelled) {
          clearSession();
          router.replace("/login");
        }
      }
    }

    verify();

    return () => {
      isCancelled = true;
    };
  }, [mounted, router]);

  // Render a consistent fallback on both Server and initial Client Hydration
  if (!mounted || !isAuthorized) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-white">
        <p className="text-sm text-zinc-400">Checking authorization...</p>
      </div>
    );
  }

  return <div className="min-h-screen bg-black text-white">{children}</div>;
}