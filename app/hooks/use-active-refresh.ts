"use client";

import { useEffect, useRef } from "react";
import { getSession, saveToken, clearSession } from "@/lib/auth";

const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // Check and refresh every 10 minutes

export function useActiveRefresh() {
  const userIsActive = useRef(false);

  useEffect(() => {
    // 1. Mark user as active on interaction
    const handleActivity = () => {
      userIsActive.current = true;
    };

    window.addEventListener("mousemove", handleActivity);
    window.addEventListener("keydown", handleActivity);
    window.addEventListener("click", handleActivity);
    window.addEventListener("scroll", handleActivity);

    // 2. Periodically refresh token if activeness was detected
    const interval = setInterval(async () => {
      const session = getSession();
      if (!session) return;

      if (userIsActive.current) {
        userIsActive.current = false; // Reset activeness flag

        try {
          const res = await fetch("/api/v1/auth/refresh", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.token}`,
            },
          });

          if (res.ok) {
            const data = await res.json();
            if (data.access_token) {
              saveToken(data.access_token);
            }
          } else if (res.status === 401 || res.status === 403) {
            clearSession();
            window.location.assign("/login");
          }
        } catch (error) {
          console.error("Token refresh failed due to network error", error);
        }
      }
    }, REFRESH_INTERVAL_MS);

    return () => {
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("click", handleActivity);
      window.removeEventListener("scroll", handleActivity);
      clearInterval(interval);
    };
  }, []);
}