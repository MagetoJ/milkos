"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    // Check for your stored auth token
    const token = localStorage.getItem("token");

    if (!token) {
      router.replace("/login");
    } else {
      // Decode or fetch user role, then redirect accordingly
      const userRole = localStorage.getItem("role"); // or parse from JWT
      if (userRole === "superadmin") {
        router.replace("/superadmin");
      } else {
        router.replace("/cooperatives"); // or your default user route
      }
    }
  }, [router]);

  return (
    <div className="flex h-screen items-center justify-center">
      <p>Loading...</p>
    </div>
  );
}