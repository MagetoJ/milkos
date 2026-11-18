export type MilkOSRole = "farmer" | "collector" | "cooperative";

export interface GoogleOnboardingProfile {
  onboarding_token: string;
  email: string;
  full_name: string;
  avatar_url?: string | null;
}

export interface GoogleSignupResolveResponse {
  status: "authenticated" | "onboarding_required" | "pending_approval";
  access_token?: string | null;
  token_type?: string;
  role?: MilkOSRole | string | null;
  onboarding?: GoogleOnboardingProfile | null;
}

export interface CompleteGoogleSignupPayload {
  onboarding_token: string;
  full_name: string;
  phone_number: string;
  role: MilkOSRole;
  cooperative_id?: string;
  cooperative_name?: string;
  county?: string;
  registration_number?: string;
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:8000/api"\;

export async function resolveGoogleSignup(params: {
  code?: string;
  id_token?: string;
  code_verifier?: string;
  redirect_uri?: string;
}): Promise<GoogleSignupResolveResponse> {
  const res = await fetch(`${API_BASE}/auth/google/resolve-signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to verify Google account.");
  }
  return res.json();
}

export async function completeGoogleSignup(
  payload: CompleteGoogleSignupPayload
): Promise<GoogleSignupResolveResponse> {
  const res = await fetch(`${API_BASE}/auth/google/complete-signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to complete Google sign-up.");
  }
  return res.json();
}

export function getRoleDashboardPath(role?: string | null): string {
  switch (role) {
    case "collector":
      return "/collector";
    case "cooperative":
      return "/cooperatives";
    case "superadmin":
      return "/superadmin";
    case "farmer":
    default:
      return "/farmer";
  }
}
