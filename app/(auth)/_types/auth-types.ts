export interface LoginPayload {
  /** An email address or a phone number. */
  identifier: string
  password: string
}

export interface RegisterPayload {
  full_name: string
  email: string
  phone_number: string
  password: string
  role: 'FARMER' | 'COLLECTOR'
}

export type UserRole = 'SUPER_ADMIN' | 'COOP_ADMIN' | 'MANAGER' | 'COLLECTOR' | 'FARMER'

export interface AuthResponse {
  success: boolean
  token?: string
  role?: UserRole
  message?: string
  /** Machine-readable reason a sign-in was refused (activation_required, suspended, locked...). */
  code?: string
  mfaRequired?: boolean
  mfaToken?: string
  mustChangePassword?: boolean
}