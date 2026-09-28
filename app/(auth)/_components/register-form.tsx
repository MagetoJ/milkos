'use client'

import { useState, type FormEvent } from 'react'
import type { RegisterPayload } from '../_types/auth-types'
import { AuthCard } from './auth-card'

export function RegisterForm() {
  const [submittedId, setSubmittedId] = useState('')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const application = Object.fromEntries(formData.entries()) as unknown as RegisterPayload
    if (Object.values(application).some((value) => !String(value).trim())) return
    setSubmittedId(`APP-${Math.floor(100000 + Math.random() * 900000)}`)
  }

  if (submittedId) {
    return (
      <AuthCard title="Application received" description="A Milkflow administrator will review your cooperative details.">
        <div className="rounded-lg border border-[#385046] bg-[#17231e] px-4 py-3 text-center font-mono text-lg font-bold text-[#9ed3b7]">{submittedId}</div>
        <a href="/login" className="mt-5 block text-center text-sm font-semibold text-[#9ed3b7] hover:underline">Return to sign in</a>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Apply as a cooperative" description="Submit your organization details for administrator verification.">
      <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
        {[
          ['fullName', 'Applicant full name', 'e.g. Arjun Kapoor'],
          ['organization', 'Organization name', 'e.g. Green Valley Dairy'],
          ['email', 'Email address', 'you@company.com'],
          ['phone', 'SMS phone number', '+254 7XX XXX XXX'],
          ['nationalId', 'National ID number', 'ID number'],
          ['kraPin', 'KRA PIN', 'A000000000X'],
          ['location', 'Location', 'County or town'],
        ].map(([name, label, placeholder]) => (
          <label key={name} className="block text-xs font-semibold text-[#d1e1d8]">
            {label}
            <input name={name} type={name === 'email' ? 'email' : 'text'} required placeholder={placeholder} className="mt-1.5 h-10 w-full rounded-lg border px-3 text-sm outline-none focus:border-[#65b58a]" />
          </label>
        ))}
        <button type="submit" className="mt-2 h-11 rounded-lg bg-[#176044] text-sm font-bold text-white transition hover:bg-[#207650] sm:col-span-2">Submit application</button>
      </form>
      <p className="mt-5 text-center text-sm text-[#d1e1d8]">Already have access? <a href="/login" className="font-semibold text-[#9ed3b7] hover:underline">Sign in</a></p>
    </AuthCard>
  )
}