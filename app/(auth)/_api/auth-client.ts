import type { AuthResponse, LoginPayload } from '../_types/auth-types'

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export async function loginUser(payload: LoginPayload): Promise<AuthResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`Sign in failed (${response.status})`)
  }

  return response.json() as Promise<AuthResponse>
}