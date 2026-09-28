export interface LoginPayload {
  email: string
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
}