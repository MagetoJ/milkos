'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';

export default function AdminApplicationsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function load() {
    try {
      setItems(await apiFetch<any[]>('/cooperatives/applications?status=PENDING'));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load applications.');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function review(id: string, status: string) {
    setBusy(id);
    try {
      await apiFetch(`/cooperatives/applications/${id}/review`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the decision.');
    } finally {
      setBusy('');
    }
  }

  return (
    <main className="admin">
      <header>
        <div>
          <div className="eyebrow">PLATFORM CONTROL</div>
          <h1>Cooperative applications</h1>
          <p>Review applicants before a cooperative becomes active.</p>
        </div>
      </header>
      {error && <div className="error" role="alert">{error}</div>}
      <section className="panel table">
        <table>
          <thead>
            <tr>
              <th>Reference</th>
              <th>Cooperative</th>
              <th>Submitted</th>
              <th>Status</th>
              <th>Decision</th>
            </tr>
          </thead>
          <tbody>
            {items.map((x) => (
              <tr key={x.id}>
                <td>{x.reference}</td>
                <td>{x.cooperative?.name}</td>
                <td>{new Date(x.submittedAt).toLocaleDateString()}</td>
                <td>{x.status}</td>
                <td>
                  <button disabled={busy === x.id} onClick={() => review(x.id, 'APPROVED')}>
                    Approve
                  </button>
                  <button disabled={busy === x.id} onClick={() => review(x.id, 'MORE_INFORMATION_REQUIRED')}>
                    Request info
                  </button>
                  <button disabled={busy === x.id} onClick={() => review(x.id, 'REJECTED')}>
                    Reject
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <div className="empty">No pending applications.</div>}
      </section>
    </main>
  );
}