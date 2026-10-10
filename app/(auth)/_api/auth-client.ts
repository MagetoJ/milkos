import type { AuthResponse, LoginPayload, UserRole } from '../_types/auth-types'
import { saveToken } from '@/lib/auth'

interface LoginApiResponse {
  access_token?: string
  role?: UserRole
  user_id?: string
  must_change_password?: boolean
  mfa_required?: boolean
  mfa_token?: string
  message?: string
  detail?: string | { msg: string }[]
}

const VALID_ROLES: readonly UserRole[] = ['SUPER_ADMIN', 'COOP_ADMIN', 'MANAGER', 'COLLECTOR', 'FARMER']

/** FastAPI returns `detail` as a string, or as an array of validation errors (422). */
function readDetail(detail: LoginApiResponse['detail']): string | undefined {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail) && detail.length > 0) return detail.map((d) => d.msg).join(', ')
  return undefined
}

export async function loginUser(payload: LoginPayload): Promise<AuthResponse> {
  let res: Response
  try {
    res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: payload.identifier, password: payload.password }),
    })
  } catch {
    return { success: false, message: 'Network error. Please check your connection and try again.' }
  }

  // When uvicorn is down, the Next.js rewrite answers with a plain-text 500 page.
  // Parsing that with res.json() used to throw and surface as a misleading "Network error".
  let data: LoginApiResponse = {}
  try {
    data = (await res.json()) as LoginApiResponse
  } catch {
    return {
      success: false,
      message:
        res.status >= 500
          ? `The MilkOS API is unavailable (HTTP ${res.status}). Is the FastAPI server running on port 8000?`
          : `Unexpected response from the API (HTTP ${res.status}).`,
    }
  }

  if (!res.ok) {
    return {
      success: false,
      code: res.headers.get('x-error-code') ?? undefined,
      message: readDetail(data.detail) || `Login failed (HTTP ${res.status}).`,
    }
  }

  if (data.mfa_required && data.mfa_token) {
    return { success: false, mfaRequired: true, mfaToken: data.mfa_token, message: data.message }
  }

  if (!data.access_token || !data.role || !VALID_ROLES.includes(data.role)) {
    return { success: false, message: 'The authentication service returned an invalid response.' }
  }

  saveToken(data.access_token)
  return { success: true, token: data.access_token, role: data.role, mustChangePassword: !!data.must_change_password }
}
