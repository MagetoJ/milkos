"use client";

import React, { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  completeGoogleSignup,
  getRoleDashboardPath,
  GoogleOnboardingProfile,
  MilkOSRole,
} from "../_api/google-signup-client";

interface GoogleSignupOnboardingProps {
  /** Optional: pass your existing NativeGoogleOAuth trigger button if already exported */
  googleButtonSlot?: React.ReactNode;
  onStartGoogleSignup?: () => Promise<void> | void;
}

export function GoogleSignupOnboarding({
  googleButtonSlot,
  onStartGoogleSignup,
}: GoogleSignupOnboardingProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [profile, setProfile] = useState<GoogleOnboardingProfile | null>(null);
  const [fullName, setFullName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [role, setRole] = useState<MilkOSRole>("farmer");
  const [cooperativeName, setCooperativeName] = useState("");
  const [county, setCounty] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate onboarding state from Web callback or Capacitor Android deep-link params
  useEffect(() => {
    const isOnboarding = searchParams.get("google_onboarding") === "1";
    const token = searchParams.get("token");
    const email = searchParams.get("email");
    const name = searchParams.get("name") || "";

    if (isOnboarding && token && email) {
      setProfile({
        onboarding_token: token,
        email,
        full_name: name,
      });
      setFullName(name);
    }
  }, [searchParams]);

  const handleCompleteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    setSubmitting(true);
    setError(null);
    try {
      const result = await completeGoogleSignup({
        onboarding_token: profile.onboarding_token,
        full_name: fullName,
        phone_number: phoneNumber,
        role,
        cooperative_name: cooperativeName || undefined,
        county: county || undefined,
        registration_number: registrationNumber || undefined,
      });

      if (result.status === "pending_approval") {
        router.push("/application-status");
        return;
      }

      if (result.access_token) {
        localStorage.setItem("access_token", result.access_token);
        router.push(getRoleDashboardPath(result.role));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not complete registration.");
    } finally {
      setSubmitting(false);
    }
  };

  // Phase 2: Google verified -> capture MilkOS onboarding details (no password needed)
  if (profile) {
    return (
      <form
        onSubmit={handleCompleteSubmit}
        className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/40 p-5"
      >
        <div className="flex items-center justify-between border-b border-emerald-200/70 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
              Google Account Verified
            </p>
            <p className="text-sm font-medium text-slate-900">{profile.email}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setProfile(null);
              router.replace("/register");
            }}
            className="text-xs text-slate-500 underline hover:text-slate-800"
          >
            Use another account
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Full Name</label>
          <input
            type="text"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Phone Number (M-Pesa / SMS Alerts)
          </label>
          <input
            type="tel"
            required
            placeholder="+2547..."
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Account Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as MilkOSRole)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="farmer">Dairy Farmer</option>
            <option value="collector">Milk Collector / Grader</option>
            <option value="cooperative">Dairy Cooperative / Society</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            {role === "cooperative" ? "Cooperative Name" : "Affiliated Cooperative Name"}
          </label>
          <input
            type="text"
            required
            placeholder="e.g. Kiambu Dairy Farmers Co-op"
            value={cooperativeName}
            onChange={(e) => setCooperativeName(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
        </div>

        {role === "cooperative" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">County</label>
              <input
                type="text"
                required
                value={county}
                onChange={(e) => setCounty(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Registration Number
              </label>
              <input
                type="text"
                value={registrationNumber}
                onChange={(e) => setRegistrationNumber(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {submitting ? "Creating MilkOS Account..." : "Complete Google Sign-Up"}
        </button>
      </form>
    );
  }

  // Phase 1: Initial Google Sign-Up trigger button
  return (
    <div className="mb-5">
      {googleButtonSlot ? (
        googleButtonSlot
      ) : (
        <button
          type="button"
          onClick={() => onStartGoogleSignup?.()}
          className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <span>Continue with Google</span>
        </button>
      )}
      <div className="relative my-4 flex items-center justify-center">
        <span className="border-t border-slate-200 w-full" />
        <span className="bg-white px-3 text-xs uppercase text-slate-400">or with email</span>
        <span className="border-t border-slate-200 w-full" />
      </div>
    </div>
  );
}
