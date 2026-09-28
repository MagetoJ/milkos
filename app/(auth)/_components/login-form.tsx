'use client'

import { useState, type FormEvent } from 'react'
import { loginUser } from '../_api/auth-client'
import { AuthCard } from './auth-card'

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      const result = await loginUser({ email, password })
      if (!result.success) {
        setError(result.error || result.message || 'Sign in failed.')
        return
      }
      window.location.assign('/')
    } catch {
      setError('Unable to reach the Milkflow API. Check that the backend is running.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthCard title="Welcome back" description="Sign in to your Milkflow workspace.">
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block text-xs font-semibold text-[#d1e1d8]">
          Email address
          <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" className="mt-2 h-11 w-full rounded-lg border px-3 text-sm outline-none focus:border-[#65b58a]" />
        </label>
        <label className="block text-xs font-semibold text-[#d1e1d8]">
          Password
          <input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" className="mt-2 h-11 w-full rounded-lg border px-3 text-sm outline-none focus:border-[#65b58a]" />
        </label>
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <button type="submit" disabled={isSubmitting} className="h-11 w-full rounded-lg bg-[#176044] text-sm font-bold text-white transition hover:bg-[#207650] disabled:opacity-60">
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="mt-5 text-center text-sm text-[#d1e1d8]">New cooperative? <a href="/register" className="font-semibold text-[#9ed3b7] hover:underline">Apply for access</a></p>
    </AuthCard>
  )
}