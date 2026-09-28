"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function SuperadminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function checkAuth() {
      try {
        const res = await fetch("http://localhost:8000/api/v1/auth/me", {
          method: "GET",
          credentials: "include", // Send HttpOnly cookies
        });

        if (!res.ok) {
          if (isMounted) {
            setChecking(false);
            router.push("/login");
          }
          return;
        }

        const user = await res.json();
        if (user.role !== "SUPER_ADMIN") {
          if (isMounted) {
            setChecking(false);
            router.push("/login");
          }
          return;
        }

        if (isMounted) {
          setAuthorized(true);
          setChecking(false);
        }
      } catch (err) {
        if (isMounted) {
          setChecking(false);
          router.push("/login");
        }
      }
    }

    checkAuth();

    return () => {
      isMounted = false;
    };
  }, [router]);

  if (checking || !authorized) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500">Checking authorization...</p>
      </div>
    );
  }

  return <div className="min-h-screen bg-slate-50">{children}</div>;
}