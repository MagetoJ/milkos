import type { AuthResponse, LoginPayload, UserRole } from '../_types/auth-types'

interface LoginApiResponse {
  access_token?: string
  role?: UserRole
  detail?: string
}

export async function loginUser(payload: LoginPayload): Promise<AuthResponse> {
  try {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const data = await res.json() as LoginApiResponse

    if (!res.ok) {
      return { success: false, message: data.detail || 'Login failed' }
    }

    if (!data.access_token || !data.role) {
      return { success: false, message: 'The authentication service returned an invalid response.' }
    }

    localStorage.setItem('milkflow_token', data.access_token)
    return { success: true, token: data.access_token, role: data.role }
  } catch {
    return { success: false, message: 'Network error. Please try again.' }
  }
}