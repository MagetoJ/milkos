"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { App, URLOpenListenerEvent } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { getRoleDashboardPath } from "@/app/(auth)/_api/google-signup-client";

export function CapacitorAuthListener() {
  const router = useRouter();

  useEffect(() => {
    const handleUrlOpen = async (event: URLOpenListenerEvent) => {
      try {
        await Browser.close().catch(() => {});
        const parsed = new URL(event.url);

        // 1. New Cooperative Admin Google Sign-Up -> route to onboarding completion
        if (parsed.searchParams.get("google_onboarding") === "1") {
          router.push(`/register?${parsed.searchParams.toString()}`);
          return;
        }

        // 2. Cooperative application awaiting Superadmin approval
        if (parsed.searchParams.get("status") === "pending_approval") {
          router.push("/application-status?status=pending_approval");
          return;
        }

        // 3. Existing active user (Coop Admin or Coop-invited Farmer/Collector) sign-in
        const accessToken = parsed.searchParams.get("access_token");
        const role = parsed.searchParams.get("role");
        if (accessToken) {
          localStorage.setItem("access_token", accessToken);
          router.push(getRoleDashboardPath(role));
        }
      } catch (err) {
        console.error("Failed to handle Capacitor OAuth deep link:", err);
      }
    };

    const listenerPromise = App.addListener("appUrlOpen", handleUrlOpen);
    return () => {
      listenerPromise.then((handle) => handle.remove()).catch(() => {});
    };
  }, [router]);

  return null;
}

export default CapacitorAuthListener;
