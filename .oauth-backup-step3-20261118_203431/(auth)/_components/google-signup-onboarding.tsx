"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  completeGoogleSignup,
  getRoleDashboardPath,
  GoogleOnboardingProfile,
} from "../_api/google-signup-client";

interface GoogleSignupOnboardingProps {
  googleButtonSlot?: React.ReactNode;
  onStartGoogleSignup?: () => Promise<void> | void;
}

function GoogleSignupOnboardingInner({
  googleButtonSlot,
  onStartGoogleSignup,
}: GoogleSignupOnboardingProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [profile, setProfile] = useState<GoogleOnboardingProfile | null>(null);
  const [fullName, setFullName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [cooperativeName, setCooperativeName] = useState("");
  const [county, setCounty] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        role: "cooperative",
        cooperative_name: cooperativeName,
        county,
        registration_number: registrationNumber || undefined,
      });

      if (result.status === "pending_approval") {
        router.push("/application-status?status=pending_approval");
        return;
      }

      if (result.access_token) {
        localStorage.setItem("access_token", result.access_token);
        router.push(getRoleDashboardPath(result.role));
      }
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not complete Cooperative Administrator registration."
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (profile) {
    return (
      <form
        onSubmit={handleCompleteSubmit}
        className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/40 p-5"
      >
        <div className="flex items-center justify-between border-b border-emerald-200/70 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
              Google Verified · Cooperative Administrator Sign-Up
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
            Switch Google account
          </button>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Only <strong>Cooperative Administrators</strong> register here. Once your cooperative
          is approved, you will be able to add and onboard Farmers, Collectors, and Staff from
          your Cooperative Team dashboard.
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Administrator Full Name
          </label>
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
            Administrator Phone Number
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
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Cooperative / Society Name
          </label>
          <input
            type="text"
            required
            placeholder="e.g. Githunguri Dairy Farmers Co-op"
            value={cooperativeName}
            onChange={(e) => setCooperativeName(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">County</label>
            <input
              type="text"
              required
              placeholder="e.g. Kiambu"
              value={county}
              onChange={(e) => setCounty(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Co-op Registration No.
            </label>
            <input
              type="text"
              placeholder="CS/..."
              value={registrationNumber}
              onChange={(e) => setRegistrationNumber(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {submitting
            ? "Submitting Cooperative Application..."
            : "Submit Cooperative Admin Registration"}
        </button>
      </form>
    );
  }

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
          <span>Sign up as Cooperative Admin with Google</span>
        </button>
      )}
      <p className="mt-2 text-center text-xs text-slate-500">
        Cooperative Admin registration only · Farmers &amp; Collectors are onboarded by their
        Cooperative after approval.
      </p>
      <div className="relative my-4 flex items-center justify-center">
        <span className="w-full border-t border-slate-200" />
        <span className="bg-white px-3 text-xs uppercase text-slate-400">or with email</span>
        <span className="w-full border-t border-slate-200" />
      </div>
    </div>
  );
}

export function GoogleSignupOnboarding(props: GoogleSignupOnboardingProps) {
  return (
    <Suspense fallback={null}>
      <GoogleSignupOnboardingInner {...props} />
    </Suspense>
  );
}
