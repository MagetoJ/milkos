'use client';

import { useState, useEffect } from 'react';
import { SuperadminStats, CooperativeApplication, PaymentVerificationItem } from '../_types/superadmin-types';
import { 
  fetchSuperadminStats, 
  fetchPendingApplications, 
  fetchPendingPayments, 
  verifyPayment, 
  processApplication 
} from '../_api/superadmin-client';

export function SuperadminDashboard() {
  const [stats, setStats] = useState<SuperadminStats | null>(null);
  const [applications, setApplications] = useState<CooperativeApplication[]>([]);
  const [payments, setPayments] = useState<PaymentVerificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);

  const loadData = async () => {
    setLoading(true);
    const [sRes, aRes, pRes] = await Promise.allSettled([
      fetchSuperadminStats(),
      fetchPendingApplications(),
      fetchPendingPayments()
    ]);
    if (sRes.status === 'fulfilled') setStats(sRes.value);
    if (aRes.status === 'fulfilled') setApplications(aRes.value);
    if (pRes.status === 'fulfilled') setPayments(pRes.value);

    const errors = [sRes, aRes, pRes]
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
    errors.forEach((message) => console.error('Superadmin data load error:', message));
    setLoadErrors(errors);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleVerifyPayment = async (id: string, action: 'VERIFY' | 'REJECT') => {
    const success = await verifyPayment(id, action);
    if (success) loadData();
  };

  const handleProcessApplication = async (id: string, action: 'APPROVE' | 'REJECT') => {
    const success = await processApplication(id, action);
    if (success) loadData();
  };

  if (loading) {
    return (
      <div className="p-12 text-center text-zinc-400 text-sm font-medium">
        Loading Platform Superadmin Portal...
      </div>
    );
  }

  return (
    <div className="space-y-8 p-6 max-w-7xl mx-auto text-white">
      <div>
        <h1 className="text-2xl font-bold text-white">Platform Superadmin Control Center</h1>
        <p className="text-xs text-zinc-400 mt-1">
          Global multi-tenant governance, cooperative onboarding verification, and SMS credit issuing.
        </p>
      </div>

      {loadErrors.length > 0 && (
        <div role="alert" className="p-4 border border-red-800 bg-red-950/80 rounded-xl text-xs text-red-200">
          {loadErrors.join(' · ')}
        </div>
      )}

      {/* Platform Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl shadow-md">
          <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Cooperatives</p>
          <p className="text-2xl font-extrabold text-white mt-1">{stats?.total_cooperatives ?? 0}</p>
        </div>

        <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl shadow-md">
          <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Active Coolers</p>
          <p className="text-2xl font-extrabold text-white mt-1">{stats?.total_coolers ?? 0}</p>
        </div>

        <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl shadow-md">
          <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Milk Today (KG)</p>
          <p className="text-2xl font-extrabold text-emerald-400 mt-1">
            {stats?.milk_today_kg?.toLocaleString() ?? 0} KG
          </p>
        </div>

        <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl shadow-md">
          <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Pending Verifications</p>
          <p className="text-2xl font-extrabold text-amber-400 mt-1">
            {(stats?.pending_applications_count ?? 0) + (stats?.pending_payments_count ?? 0)}
          </p>
        </div>
      </div>

      {/* Dual Queue Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Onboarding Applications Queue */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-md space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white">Cooperative Onboarding Queue</h2>
            <span className="text-xs bg-amber-950/80 text-amber-300 border border-amber-800 px-2.5 py-0.5 rounded-full font-semibold">
              {applications.length} Pending
            </span>
          </div>

          {applications.length === 0 ? (
            <p className="text-xs text-zinc-400 py-8 text-center">No pending cooperative applications.</p>
          ) : (
            <div className="space-y-3">
              {applications.map((app) => (
                <div key={app.id} className="p-4 border border-zinc-800 rounded-lg bg-zinc-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-white">{app.org_name}</p>
                    <p className="text-xs text-zinc-300 mt-0.5">{app.applicant_name} ({app.phone})</p>
                    <p className="text-xs text-zinc-400 mt-0.5">{app.location}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => handleProcessApplication(app.id, 'APPROVE')}
                      className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold rounded-lg transition-colors"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleProcessApplication(app.id, 'REJECT')}
                      className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* SMS Credit Verification Queue */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-md space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white">SMS Credit Top-Up Verification</h2>
            <span className="text-xs bg-emerald-950/80 text-emerald-300 border border-emerald-800 px-2.5 py-0.5 rounded-full font-semibold">
              {payments.length} Pending
            </span>
          </div>

          {payments.length === 0 ? (
            <p className="text-xs text-zinc-400 py-8 text-center">No pending M-Pesa payment verifications.</p>
          ) : (
            <div className="space-y-3">
              {payments.map((p) => (
                <div key={p.id} className="p-4 border border-zinc-800 rounded-lg bg-zinc-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-white">{p.cooperative_name}</p>
                    <p className="text-xs text-emerald-400 font-semibold mt-0.5">
                      {p.credits_requested.toLocaleString()} Credits ({p.amount_kes} KES)
                    </p>
                    <p className="text-xs text-zinc-400 mt-0.5">Masked Ref: {p.masked_mpesa_ref}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => handleVerifyPayment(p.id, 'VERIFY')}
                      className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold rounded-lg transition-colors"
                    >
                      Verify & Issue
                    </button>
                    <button
                      onClick={() => handleVerifyPayment(p.id, 'REJECT')}
                      className="px-3 py-1.5 bg-red-950 hover:bg-red-900 text-red-200 text-xs font-medium rounded-lg border border-red-800 transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

export default SuperadminDashboard;