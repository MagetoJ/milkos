import { LoginPayload, AuthResponse } from '../_types/auth-types';

export async function loginUser(payload: LoginPayload): Promise<AuthResponse> {
  try {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      return { success: false, message: data.detail || 'Login failed' };
    }

    if (data.access_token) {
      localStorage.setItem('milkflow_token', data.access_token);
    }

    return { 
      success: true, 
      token: data.access_token, 
      role: data.role 
    };
  } catch {
    return { success: false, message: 'Network error. Please try again.' };
  }
}