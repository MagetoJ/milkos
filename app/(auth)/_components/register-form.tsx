'use client';

import { useState, type FormEvent, type ChangeEvent } from 'react';
import Link from 'next/link';

export function RegisterForm() {
  const [formData, setFormData] = useState({
    cooperative_name: '',
    registration_number: '',
    kra_pin: '',
    county: '',
    location: '',
    admin_full_name: '',
    admin_email: '',
    admin_phone: '',
    admin_id_number: '',
    password: '',
    additional_info: '',
  });

  const [message, setMessage] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: FormEvent) => {
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
        setIsSubmitted(true);
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data.detail)) {
        const errorMsgs = data.detail
          .map((d: { loc: string[]; msg: string }) => `${d.loc[d.loc.length - 1]}: ${d.msg}`)
          .join(' | ');
        setMessage(errorMsgs);
      } else {
        setMessage(data.detail || `Registration failed (HTTP ${res.status}).`);
      }
    } catch {
      setMessage('Network error connecting to backend.');
    } finally {
      setLoading(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-6 text-center space-y-4">
        <div className="w-12 h-12 bg-emerald-900/50 text-emerald-400 border border-emerald-700/50 rounded-full flex items-center justify-center mx-auto text-xl font-bold">
          ✓
        </div>
        <h3 className="text-lg font-bold text-white">Application Submitted</h3>
        <p className="text-xs text-zinc-300 leading-relaxed max-w-md mx-auto">
          Your cooperative application has been logged and is awaiting Superadmin approval. You will be able to log in once verified.
        </p>
        <Link
          href="/login"
          className="inline-block px-5 py-2.5 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold rounded-lg transition-colors"
        >
          Return to Sign In
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-left">
      {message && (
        <div role="alert" className="p-3 bg-red-950/50 border border-red-800/80 rounded-lg text-xs text-red-300">
          {message}
        </div>
      )}

      {/* Organization Info */}
      <div className="space-y-3 border-b border-zinc-800 pb-4">
        <p className="text-xs font-bold uppercase tracking-wider text-emerald-400">Cooperative Details</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Cooperative Name *</label>
            <input
              required
              name="cooperative_name"
              value={formData.cooperative_name}
              onChange={handleChange}
              placeholder="Limuru Farmers Co-op"
              className="w-full px-3 py-2 text-xs bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:border-emerald-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Reg / License No. *</label>
            <input
              required
              name="registration_number"
              value={formData.registration_number}
              onChange={handleChange}
              placeholder="CS/12345"
              className="w-full px-3 py-2 text-xs bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:border-emerald-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">County *</label>
            <input
              required
              name="county"
              value={formData.county}
              onChange={handleChange}
              placeholder="Kiambu County"
              className="w-full px-3 py-2 text-xs bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:border-emerald-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Location / Address *</label>
            <input
              required
              name="location"
              value={formData.location}
              onChange={handleChange}
              placeholder="Limuru Town"
              className="w-full px-3 py-2 text-xs bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:border-emerald-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">KRA PIN *</label>
            <input
              required
              name="kra_pin"
              value={formData.kra_pin}
              onChange={handleChange}
              placeholder="P051234567Z"
              className="w-full px-3 py-2 text-xs bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:border-emerald-500 outline-none"
            />
          </div>
        </div>
      </div>

      {/* Admin Contact Info */}
      <div className="space-y-3 border-b border-zinc-800 pb-4">
        <p className="text-xs font-bold uppercase tracking-wider text-emerald-400">Primary Administrator Details</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Admin Full Name *</label>
            <input
              required
              name="admin_full_name"
              value={formData.admin_full_name}
              onChange={handleChange}
              placeholder="Jane Wanjiku"
              className="w-full px-3 py-2 text-xs bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:border-emerald-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">National ID No. *</label>
            <input
              required
              name="admin_id_number"
              value={formData.admin_id_number}
              onChange={handleChange}
              placeholder="28491029"
              className="w-full px-3 py-2 text-xs bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:border-emerald-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Official Email *</label>
            <input
              required
              type="email"
              name="admin_email"
              value={formData.admin_email}
              onChange={handleChange}
              placeholder="admin@limurudairy.co.ke"
              className="w-full px-3 py-2 text-xs bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:border-emerald-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Official Phone *</label>
            <input
              required
              name="admin_phone"
              value={formData.admin_phone}
              onChange={handleChange}
              placeholder="+254712345678"
              className="w-full px-3 py-2 text-xs bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:border-emerald-500 outline-none"
            />
          </div>
        </div>
      </div>

      {/* Account Password */}
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-zinc-300 mb-1">Account Password *</label>
          <input
            required
            type="password"
            name="password"
            value={formData.password}
            onChange={handleChange}
            placeholder="At least 8 chars, 1 uppercase, 1 digit"
            className="w-full px-3 py-2 text-xs bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:border-emerald-500 outline-none"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 px-4 bg-emerald-700 hover:bg-emerald-600 text-white font-semibold text-xs rounded-lg transition-colors disabled:opacity-50 mt-4"
      >
        {loading ? 'Submitting Application...' : 'Submit Cooperative Application'}
      </button>

      <p className="text-center text-xs text-zinc-400 pt-2">
        Already registered?{' '}
        <Link href="/login" className="text-emerald-400 font-semibold hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}