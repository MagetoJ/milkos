'use client';

import { useEffect, useState, type ReactNode } from 'react';

type Farmer = Record<string, unknown>;
type TabId = 'overview' | 'collections' | 'farmers' | 'centres' | 'devices' | 'milk-loss' | 'audit';

function TabHeading({ title, description }: { title: string; description: string }) {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h1 style={{ margin: 0, color: '#0f172a', fontSize: '2rem' }}>{title}</h1>
      <p style={{ margin: '0.5rem 0 0', color: '#64748b' }}>{description}</p>
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <section
      style={{
        padding: '1.5rem',
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '0.5rem',
      }}
    >
      {children}
    </section>
  );
}

function OverviewTab() {
  return (
    <>
      <TabHeading title="Overview" description="Monitor your cooperative's daily operations." />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '1rem',
        }}
      >
        <Panel>
          <strong>0 L</strong>
          <div style={{ color: '#64748b' }}>Today's collection</div>
        </Panel>
        <Panel>
          <strong>0</strong>
          <div style={{ color: '#64748b' }}>Active farmers</div>
        </Panel>
        <Panel>
          <strong>0</strong>
          <div style={{ color: '#64748b' }}>Collection centres</div>
        </Panel>
      </div>
    </>
  );
}

function CollectionsTab() {
  return (
    <>
      <TabHeading title="Collections" description="Review milk collection activity and records." />
      <Panel>
        <p style={{ margin: 0, color: '#64748b' }}>No collection records yet.</p>
      </Panel>
    </>
  );
}

function FarmersTab({ farmers, loading }: { farmers: Farmer[]; loading: boolean }) {
  return (
    <>
      <TabHeading title="Farmers" description="Manage farmers connected to this cooperative." />
      <Panel>
        {loading ? (
          <p style={{ margin: 0, color: '#64748b' }}>Loading farmers...</p>
        ) : farmers.length === 0 ? (
          <p style={{ margin: 0, color: '#64748b' }}>No farmers found.</p>
        ) : (
          <p style={{ margin: 0 }}>{farmers.length} farmer(s) registered.</p>
        )}
      </Panel>
    </>
  );
}

function CentresTab() {
  return (
    <>
      <TabHeading title="Centres" description="Manage milk collection centres." />
      <Panel>
        <p style={{ margin: 0, color: '#64748b' }}>No collection centres yet.</p>
      </Panel>
    </>
  );
}

function DevicesTab() {
  return (
    <>
      <TabHeading title="Devices" description="Track registered collection devices." />
      <Panel>
        <p style={{ margin: 0, color: '#64748b' }}>No devices registered.</p>
      </Panel>
    </>
  );
}

function MilkLossTab() {
  return (
    <>
      <TabHeading title="Milk Loss" description="Review quality and loss trends." />
      <Panel>
        <p style={{ margin: 0, color: '#64748b' }}>No milk loss data yet.</p>
      </Panel>
    </>
  );
}

function AuditTab() {
  return (
    <>
      <TabHeading title="Audit" description="Review activity and system events." />
      <Panel>
        <p style={{ margin: 0, color: '#64748b' }}>No audit events yet.</p>
      </Panel>
    </>
  );
}

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [apiStatus, setApiStatus] = useState('Checking API...');
  const [farmers, setFarmers] = useState<Farmer[]>([]);
  const [loadingFarmers, setLoadingFarmers] = useState(false);

  const api = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
  const cooperativeId = '13da2e35-25c2-4f1b-96ea-ac0170ff7e12';

  useEffect(() => {
    fetch(`${api}/health`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`API returned ${response.status}`);
        }

        return response.json();
      })
      .then((data) => {
        setApiStatus(data.status === 'ok' ? 'FastAPI connected' : 'FastAPI responded');
      })
      .catch((error) => {
        console.error('FastAPI connection failed:', error);
        setApiStatus('FastAPI connection failed');
      });
  }, [api]);

  useEffect(() => {
    if (activeTab !== 'farmers') {
      return;
    }

    let isMounted = true;
    setLoadingFarmers(true);

    fetch(`${api}/cooperatives/${cooperativeId}/farmers`)
      .then((response) => (response.ok ? response.json() : []))
      .then((data) => {
        if (isMounted) {
          setFarmers(Array.isArray(data) ? (data as Farmer[]) : []);
        }
      })
      .catch((error) => {
        console.error('Error fetching farmers:', error);
        if (isMounted) {
          setFarmers([]);
        }
      })
      .finally(() => {
        if (isMounted) {
          setLoadingFarmers(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [activeTab, api, cooperativeId]);

  const navItems: Array<{ id: TabId; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'collections', label: 'Collections' },
    { id: 'farmers', label: 'Farmers' },
    { id: 'centres', label: 'Centres' },
    { id: 'devices', label: 'Devices' },
    { id: 'milk-loss', label: 'Milk Loss' },
    { id: 'audit', label: 'Audit' },
  ];

  return (
    <div
      style={{
        display: 'flex',
        minHeight: 'calc(100vh - 60px)',
        background: '#f8fafc',
      }}
    >
      <aside
        style={{
          width: '220px',
          background: '#ffffff',
          borderRight: '1px solid #e2e8f0',
          padding: '1.5rem 1rem',
        }}
      >
        <div
          style={{
            fontWeight: '700',
            fontSize: '1.25rem',
            marginBottom: '1.5rem',
            color: '#0f172a',
          }}
        >
          MilkOS
        </div>

        <nav
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.375rem',
          }}
        >
          {navItems.map((item) => {
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
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

      <main style={{ flex: 1, padding: '2rem' }}>
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.75rem 1rem',
            borderRadius: '0.5rem',
            background: apiStatus === 'FastAPI connected' ? '#ecfdf5' : '#fef3c7',
            border: apiStatus === 'FastAPI connected' ? '1px solid #a7f3d0' : '1px solid #fcd34d',
            color: apiStatus === 'FastAPI connected' ? '#065f46' : '#92400e',
            fontSize: '0.875rem',
            fontWeight: 600,
          }}
        >
          API Status: {apiStatus}
        </div>

        <div
          style={{
            fontSize: '0.75rem',
            fontWeight: 600,
            color: '#64748b',
            textTransform: 'uppercase',
            marginBottom: '0.25rem',
          }}
        >
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