'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { KENYAN_COUNTIES } from '../_lib/onboarding-rules';
import { Submitted } from './register-form';

interface GoogleOnboardingProfile {
  onboarding_token: string;
  email: string;
  full_name: string;
}

function GoogleSignupOnboardingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [profile, setProfile] = useState<GoogleOnboardingProfile | null>(null);
  const [fullName, setFullName] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [cooperativeName, setCooperativeName] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [kraPin, setKraPin] = useState('');
  const [county, setCounty] = useState<string>(KENYAN_COUNTIES[0] || 'Kiambu');
  const [location, setLocation] = useState('');
  const [estimatedDailyLiters, setEstimatedDailyLiters] = useState('');
  const [initialCoolersCount, setInitialCoolersCount] = useState('1');
  const [additionalInfo, setAdditionalInfo] = useState('');
  const [submittedRef, setSubmittedRef] = useState<string | null | undefined>(undefined);
  const [isOpeningGoogle, setIsOpeningGoogle] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const isOnboarding = searchParams.get('google_onboarding') === '1';
    const token = searchParams.get('token');
    const email = searchParams.get('email');
    const name = searchParams.get('name') || '';

    if (isOnboarding && token && email) {
      setProfile({
        onboarding_token: token,
        email,
        full_name: name,
      });
      setFullName(name);
    }

    const googleError = searchParams.get('google_error');
    if (googleError === 'cancelled') {
      setError('Google sign-up was cancelled.');
    } else if (googleError === 'failed') {
      setError('Google sign-up failed. Please try again or complete the form below.');
    }
  }, [searchParams]);

  async function handleStartGoogleSignup() {
    setError(null);

    if (!Capacitor.isNativePlatform()) {
      window.location.href = '/api/v1/auth/google/signup';
      return;
    }

    setIsOpeningGoogle(true);
    try {
      const response = await fetch('/api/v1/auth/google/native/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: 'signup' }),
      });

      const result = (await response.json().catch(() => ({}))) as {
        authorization_url?: string;
      };

      if (!response.ok || !result.authorization_url) {
        throw new Error('Unable to start Google sign-up.');
      }

      await Browser.open({ url: result.authorization_url });
    } catch {
      setError('Unable to open Google sign-up. Please try again.');
    } finally {
      setIsOpeningGoogle(false);
    }
  }

  async function handleCompleteSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/auth/google/complete-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          onboarding_token: profile.onboarding_token,
          cooperative_name: cooperativeName,
          registration_number: registrationNumber,
          kra_pin: kraPin,
          county,
          location,
          admin_full_name: fullName,
          admin_id_number: idNumber,
          admin_phone: phoneNumber,
          estimated_daily_liters: estimatedDailyLiters ? Number(estimatedDailyLiters) : null,
          initial_coolers_count: initialCoolersCount ? Number(initialCoolersCount) : 1,
          additional_info: additionalInfo || null,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        application_id?: string;
        detail?: string | Array<{ msg?: string }> | { message?: string };
      };

      if (!response.ok) {
        if (typeof data.detail === 'string') {
          throw new Error(data.detail);
        }
        if (Array.isArray(data.detail) && data.detail[0]?.msg) {
          throw new Error(data.detail[0].msg);
        }
        if (data.detail && typeof data.detail === 'object' && 'message' in data.detail && data.detail.message) {
          throw new Error(data.detail.message);
        }
        throw new Error('Please check your Cooperative details and try again.');
      }

      setSubmittedRef(typeof data.application_id === 'string' ? data.application_id : null);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not submit Cooperative Administrator registration.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (profile && submittedRef !== undefined) {
    return (
      <div className="mb-6 rounded-xl border border-emerald-200 bg-white p-6">
        <Submitted
          reference={submittedRef}
          organization={cooperativeName.trim()}
          email={profile.email.trim().toLowerCase()}
        />
      </div>
    );
  }

  if (profile) {
    return (
      <form
        onSubmit={handleCompleteSubmit}
        className="mb-6 space-y-4 rounded-xl border border-emerald-300 bg-emerald-50/40 p-5"
      >
        <div className="flex items-center justify-between border-b border-emerald-200 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
              Google Verified · Cooperative Administrator Application
            </p>
            <p className="text-sm font-medium text-slate-900">{profile.email}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setProfile(null);
              router.replace('/register');
            }}
            className="text-xs text-slate-600 underline hover:text-slate-900"
          >
            Switch Google account
          </button>
        </div>

        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Self-registration is restricted to <strong>Cooperative Administrators</strong>. Once
          your cooperative is approved by Superadmin, sign in with Google to add Farmers,
          Collectors, and Managers.
        </p>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Official Cooperative Name *
            </label>
            <input
              type="text"
              required
              value={cooperativeName}
              onChange={(e) => setCooperativeName(e.target.value)}
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Co-op Registration / License No. *
            </label>
            <input
              type="text"
              required
              placeholder="CS/12345"
              value={registrationNumber}
              onChange={(e) => setRegistrationNumber(e.target.value)}
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">KRA PIN *</label>
            <input
              type="text"
              required
              placeholder="P051234567A"
              value={kraPin}
              onChange={(e) => setKraPin(e.target.value)}
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">County *</label>
            <select
              value={county}
              onChange={(e) => setCounty(e.target.value)}
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
            >
              {KENYAN_COUNTIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Town / Sub-County *
            </label>
            <input
              type="text"
              required
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Est. Daily Liters
            </label>
            <input
              type="number"
              min="1"
              value={estimatedDailyLiters}
              onChange={(e) => setEstimatedDailyLiters(e.target.value)}
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Initial Coolers
            </label>
            <input
              type="number"
              min="0"
              value={initialCoolersCount}
              onChange={(e) => setInitialCoolersCount(e.target.value)}
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Admin Full Name *
            </label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              National ID Number *
            </label>
            <input
              type="text"
              required
              value={idNumber}
              onChange={(e) => setIdNumber(e.target.value)}
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Admin Phone Number *
            </label>
            <input
              type="tel"
              required
              placeholder="0712 345 678"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">
            Additional Background (Optional)
          </label>
          <textarea
            rows={2}
            value={additionalInfo}
            onChange={(e) => setAdditionalInfo(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="h-11 w-full rounded-lg bg-emerald-700 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-60"
        >
          {submitting
            ? 'Submitting Cooperative Application…'
            : 'Submit Cooperative Admin Application'}
        </button>
      </form>
    );
  }

  return (
    <div className="mb-5">
      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={handleStartGoogleSignup}
        disabled={isOpeningGoogle}
        className="flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
          <path
            fill="#EA4335"
            d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.7 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.2 9 5 12 5z"
          />
          <path
            fill="#4285F4"
            d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"
          />
          <path
            fill="#FBBC05"
            d="M5.6 14.8c-.3-.8-.4-1.8-.4-2.8s.1-2 .4-2.8L1.9 6.3C.7 8.8 0 10.3 0 12s.7 3.2 1.9 5.7l3.7-2.9z"
          />
          <path
            fill="#34A853"
            d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.2-6.4-5.2L1.9 16C3.7 19.7 7.5 23 12 23z"
          />
        </svg>
        <span>
          {isOpeningGoogle ? 'Opening Google…' : 'Sign up as Cooperative Admin with Google'}
        </span>
      </button>
      <p className="mt-2 text-center text-xs text-slate-500">
        Cooperative Admin sign-up only · Farmers &amp; Collectors are onboarded by their
        Cooperative after approval.
      </p>
      <div className="relative my-4 flex items-center justify-center">
        <div className="w-full border-t border-slate-200" />
        <span className="bg-white px-3 text-xs font-semibold uppercase text-slate-400">
          Or apply with email &amp; password
        </span>
      </div>
    </div>
  );
}

export function GoogleSignupOnboarding() {
  return (
    <Suspense fallback={null}>
      <GoogleSignupOnboardingInner />
    </Suspense>
  );
}
