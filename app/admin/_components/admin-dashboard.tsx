'use client';

import { useState, useEffect } from 'react';
import { 
  AdminStats, 
  CooperativeApplication, 
  PaymentVerificationItem 
} from '../_types/admin-types';
import { 
  fetchAdminStats, 
  fetchPendingApplications, 
  fetchPendingPayments, 
  verifyPayment, 
  processApplication 
} from '../_api/admin-client';

export function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [applications, setApplications] = useState<CooperativeApplication[]>([]);
  const [payments, setPayments] = useState<PaymentVerificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const [sData, aData, pData] = await Promise.all([
        fetchAdminStats(),
        fetchPendingApplications(),
        fetchPendingPayments()
      ]);
      setStats(sData);
      setApplications(aData);
      setPayments(pData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
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
    return <div className="p-8 text-center text-slate-500 text-sm">Loading Super Admin Dashboard...</div>;
  }

  return (
    <div className="space-y-8 p-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Platform Admin Overview</h1>
        <p className="text-xs text-slate-500">Monitor multi-tenant cooperatives, system health, and verification queues.</p>
      </div>

      {/* Top Metrics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase">Cooperatives</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{stats?.total_cooperatives ?? 0}</p>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase">Active Coolers</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{stats?.total_coolers ?? 0}</p>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase">Milk Today (KG)</p>
          <p className="text-2xl font-bold text-emerald-700 mt-1">{stats?.milk_today_kg.toLocaleString() ?? 0} KG</p>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase">Action Queue</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">
            {(stats?.pending_applications_count ?? 0) + (stats?.pending_payments_count ?? 0)}
          </p>
        </div>
      </div>

      {/* Verification Queues */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Cooperative Onboarding Queue */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">Cooperative Onboarding Queue</h2>
            <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-medium">
              {applications.length} Pending
            </span>
          </div>

          {applications.length === 0 ? (
            <p className="text-xs text-slate-500 py-6 text-center">No pending cooperative applications.</p>
          ) : (
            <div className="space-y-3">
              {applications.map((app) => (
                <div key={app.id} className="p-3 border rounded-lg bg-slate-50 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{app.org_name}</p>
                    <p className="text-xs text-slate-500">{app.applicant_name} ({app.phone})</p>
                    <p className="text-xs text-slate-400">{app.location}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleProcessApplication(app.id, 'APPROVE')}
                      className="px-3 py-1 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium rounded-md"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleProcessApplication(app.id, 'REJECT')}
                      className="px-3 py-1 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-medium rounded-md"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* SMS Top-Up M-Pesa Verification Queue */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">SMS Credit Top-Up Verifications</h2>
            <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-medium">
              {payments.length} Pending
            </span>
          </div>

          {payments.length === 0 ? (
            <p className="text-xs text-slate-500 py-6 text-center">No pending M-Pesa payment verifications.</p>
          ) : (
            <div className="space-y-3">
              {payments.map((p) => (
                <div key={p.id} className="p-3 border rounded-lg bg-slate-50 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{p.cooperative_name}</p>
                    <p className="text-xs text-emerald-700 font-medium">{p.credits_requested.toLocaleString()} Credits ({p.amount_kes} KES)</p>
                    <p className="text-xs text-slate-400">Ref: {p.masked_mpesa_ref}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleVerifyPayment(p.id, 'VERIFY')}
                      className="px-3 py-1 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium rounded-md"
                    >
                      Verify
                    </button>
                    <button
                      onClick={() => handleVerifyPayment(p.id, 'REJECT')}
                      className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-800 text-xs font-medium rounded-md"
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