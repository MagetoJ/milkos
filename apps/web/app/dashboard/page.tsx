'use client';

import { useState, useEffect } from 'react';

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<'overview' | 'collections' | 'farmers' | 'centres' | 'devices' | 'milk-loss' | 'audit'>('overview');
  
  const api = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
  const cooperativeId = '13da2e35-25c2-4f1b-96ea-ac0170ff7e12'; // Mogor Smart Dairy Cooperative ID

  const [farmers, setFarmers] = useState<any[]>([]);
  const [loadingFarmers, setLoadingFarmers] = useState(false);

  useEffect(() => {
    if (activeTab === 'farmers') {
      setLoadingFarmers(true);
      fetch(`${api}/cooperatives/${cooperativeId}/farmers`)
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => setFarmers(data))
        .catch((err) => console.error('Error fetching farmers:', err))
        .finally(() => setLoadingFarmers(false));
    }
  }, [activeTab]);

  const navItems = [
    { id: 'overview', label: 'Overview' },
    { id: 'collections', label: 'Collections' },
    { id: 'farmers', label: 'Farmers' },
    { id: 'centres', label: 'Centres' },
    { id: 'devices', label: 'Devices' },
    { id: 'milk-loss', label: 'Milk Loss' },
    { id: 'audit', label: 'Audit' },
  ];

  return (
    <div style={{ display: 'flex', minHeight: 'calc(100vh - 60px)', background: '#f8fafc' }}>
      {/* MilkOS Sidebar */}
      <aside style={{ width: '220px', background: '#ffffff', borderRight: '1px solid #e2e8f0', padding: '1.5rem 1rem' }}>
        <div style={{ fontWeight: '700', fontSize: '1.25rem', marginBottom: '1.5rem', color: '#0f172a' }}>
          MilkOS
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as any)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '0.625rem 0.875rem',
                  borderRadius: '0.375rem',
                  border: 'none',
                  fontSize: '0.875rem',
                  fontWeight: isActive ? '600' : '400',
                  background: isActive ? '#e0f2fe' : 'transparent',
                  color: isActive ? '#0284c7' : '#475569',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Dynamic Tab Content */}
      <main style={{ flex: 1, padding: '2rem' }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
          MOGOR SMART DAIRY
        </div>

        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'collections' && <CollectionsTab />}
        {activeTab === 'farmers' && <FarmersTab farmers={farmers} loading={loadingFarmers} />}
        {activeTab === 'centres' && <CentresTab />}
        {activeTab === 'devices' && <DevicesTab />}
        {activeTab === 'milk-loss' && <MilkLossTab />}
        {activeTab === 'audit' && <AuditTab />}
      </main>
    </div>
  );
}

/* ---------------- Sub-views ---------------- */

function OverviewTab() {
  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: '700', color: '#0f172a', marginBottom: '1.5rem' }}>Operations Overview</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        <StatCard title="Total Collected" value="18,420 KG" />
        <StatCard title="Active Farmers" value="426" />
        <StatCard title="Intake Records" value="1,248" />
        <StatCard title="Grade A Quality" value="96.8%" />
      </div>
      <div style={{ background: '#ffffff', padding: '1.5rem', borderRadius: '0.5rem', border: '1px solid #e2e8f0', marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: '600', marginBottom: '1rem' }}>Daily Collection Trend</h3>
        <p style={{ color: '#64748b', fontSize: '0.875rem' }}>Intake volume consistent across 12 collection points.</p>
      </div>
    </div>
  );
}

function CollectionsTab() {
  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: '700', color: '#0f172a', marginBottom: '1rem' }}>Milk Collections</h1>
      <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>Live intake records synchronized from mobile scale terminals.</p>
      <table style={{ width: '100%', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '0.5rem', textAlign: 'left', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
            <th style={{ padding: '0.75rem 1rem' }}>Receipt #</th>
            <th style={{ padding: '0.75rem 1rem' }}>Farmer</th>
            <th style={{ padding: '0.75rem 1rem' }}>Centre</th>
            <th style={{ padding: '0.75rem 1rem' }}>Quantity</th>
            <th style={{ padding: '0.75rem 1rem' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ padding: '0.75rem 1rem' }}>COL-001</td>
            <td style={{ padding: '0.75rem 1rem' }}>John Kiptoo (MOG-001)</td>
            <td style={{ padding: '0.75rem 1rem' }}>Mogor Main Centre</td>
            <td style={{ padding: '0.75rem 1rem' }}>18.5 KG</td>
            <td style={{ padding: '0.75rem 1rem', color: '#16a34a', fontWeight: '600' }}>Synced</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function FarmersTab({ farmers, loading }: { farmers: any[]; loading: boolean }) {
  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: '700', color: '#0f172a', marginBottom: '1rem' }}>Registered Farmers</h1>
      {loading ? (
        <p>Loading registered farmers...</p>
      ) : farmers.length === 0 ? (
        <p style={{ color: '#64748b' }}>No farmers registered yet. Use the API or Mobile app to register members.</p>
      ) : (
        <table style={{ width: '100%', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '0.5rem', textAlign: 'left', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              <th style={{ padding: '0.75rem 1rem' }}>Member #</th>
              <th style={{ padding: '0.75rem 1rem' }}>Full Name</th>
              <th style={{ padding: '0.75rem 1rem' }}>Phone</th>
              <th style={{ padding: '0.75rem 1rem' }}>Assigned Centre</th>
            </tr>
          </thead>
          <tbody>
            {farmers.map((f) => (
              <tr key={f.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '0.75rem 1rem', fontWeight: '600' }}>{f.memberNumber}</td>
                <td style={{ padding: '0.75rem 1rem' }}>{f.fullName}</td>
                <td style={{ padding: '0.75rem 1rem' }}>{f.phone}</td>
                <td style={{ padding: '0.75rem 1rem' }}>{f.centre?.name || 'Main Intake'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CentresTab() {
  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: '700', color: '#0f172a', marginBottom: '1rem' }}>Collection Centres</h1>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '0.5rem', padding: '1rem' }}>
        <h3>Mogor Main Intake Centre</h3>
        <p style={{ color: '#64748b', fontSize: '0.875rem' }}>ID: centre_mogor_01 | Status: Active</p>
      </div>
    </div>
  );
}

function DevicesTab() {
  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: '700', color: '#0f172a', marginBottom: '1rem' }}>Smart Scales & Terminals</h1>
      <p style={{ color: '#64748b' }}>Bluetooth scales and Android collection units.</p>
    </div>
  );
}

function MilkLossTab() {
  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: '700', color: '#0f172a', marginBottom: '1rem' }}>Milk Loss & Rejection Tracking</h1>
      <p style={{ color: '#64748b' }}>Spillage, transport variance, and temperature rejection logs.</p>
    </div>
  );
}

function AuditTab() {
  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: '700', color: '#0f172a', marginBottom: '1rem' }}>Audit Trail</h1>
      <p style={{ color: '#64748b' }}>Immutable ledger of administrative actions and record approvals.</p>
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '0.5rem', border: '1px solid #e2e8f0' }}>
      <div style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: '0.25rem' }}>{title}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#0f172a' }}>{value}</div>
    </div>
  );
}
