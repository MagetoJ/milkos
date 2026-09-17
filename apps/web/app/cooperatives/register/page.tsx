'use client';
import { useState } from 'react';

export default function Register() {
  const [sent, setSent] = useState(false);
  return <main className="landing"><div className="formcard"><div className="eyebrow">COOPERATIVE ONBOARDING</div><h1>Register your cooperative</h1><p>Verify your identity first. Google identity or phone verification is required before an account and application can be created.</p>{sent ? <div className="success"><strong>Verification required</strong><span>Check your phone for the OTP. Your cooperative application will be created after verification.</span></div> : <form onSubmit={e=>{e.preventDefault();setSent(true)}}><label>Cooperative name<input required placeholder="e.g. Mogor Smart Farms" /></label><label>Phone number<input required placeholder="+254 7XX XXX XXX" /></label><label>Email <span>(optional)</span><input type="email" placeholder="manager@example.com" /></label><div className="verify"><button type="button">Continue with Google</button><button type="submit">Verify phone</button></div></form>}<small>Applications remain pending until Platform Super Admin approval. You can track the application status from your applicant dashboard.</small></div></main>;
}
