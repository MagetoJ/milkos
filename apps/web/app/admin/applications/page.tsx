'use client';

import { useEffect, useState } from 'react';

export default function AdminApplicationsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [busy, setBusy] = useState('');
  const api = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

  async function load() {
    try {
      const r = await fetch(`${api}/cooperatives/applications?status=PENDING`);
      if (r.ok) setItems(await r.json());
    } catch (err) {
      console.error('Failed to connect to API:', err);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function review(id: string, status: string) {
    setBusy(id);
    try {
      await fetch(`${api}/cooperatives/applications/${id}/review`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${localStorage.getItem('access_token') || ''}`,
        },
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (err) {
      console.error('Failed to submit review:', err);
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
