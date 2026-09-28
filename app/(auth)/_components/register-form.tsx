'use client';

import { useState } from 'react';
import Link from 'next/link';

export function RegisterForm() {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    full_name: '',
    phone_number: '',
    role: 'FARMER',
  });
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        // Hand off to the single login page.
        window.location.assign('/login?registered=1');
        return;
      }

      const data = await res.json().catch(() => ({}));
      const detail = Array.isArray(data.detail)
        ? data.detail.map((d: { msg: string }) => d.msg).join(', ')
        : data.detail;
      setMessage(detail || `Registration failed (HTTP ${res.status}).`);
    } catch {
      setMessage('Network error connecting to backend.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <input
        name="full_name"
        placeholder="Full Name"
        onChange={handleChange}
        required
        className="w-full p-2 border rounded text-slate-900"
      />
      <input
        name="email"
        type="email"
        placeholder="Email Address"
        onChange={handleChange}
        required
        className="w-full p-2 border rounded text-slate-900"
      />
      <input
        name="phone_number"
        placeholder="Phone Number (e.g., +254712345678)"
        onChange={handleChange}
        required
        className="w-full p-2 border rounded text-slate-900"
      />
      <input
        name="password"
        type="password"
        placeholder="Password (Min 8 chars, 1 uppercase, 1 digit)"
        onChange={handleChange}
        required
        className="w-full p-2 border rounded text-slate-900"
      />
      <select
        name="role"
        value={formData.role}
        onChange={handleChange}
        className="w-full p-2 border rounded text-slate-900"
      >
        <option value="FARMER">Farmer</option>
        <option value="COLLECTOR">Milk Collector</option>
      </select>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-emerald-700 text-white p-2 rounded font-medium disabled:opacity-50"
      >
        {loading ? 'Creating Account...' : 'Create Account'}
      </button>

      {message && <p role="alert" className="text-xs text-center font-medium mt-2 text-red-600">{message}</p>}

      <p className="text-center text-xs text-slate-500">
        Already have an account?{' '}
        <Link href="/login" className="font-semibold text-emerald-800 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}