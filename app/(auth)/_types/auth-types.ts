export interface LoginPayload {
  email: string
  password: string
}

export interface RegisterPayload {
  fullName: string
  organization: string
  email: string
  phone: string
  nationalId: string
  kraPin: string
  location: string
}

export interface AuthResponse {
  success: boolean;
  token?: string;
  role?: string;
  message?: string;
}