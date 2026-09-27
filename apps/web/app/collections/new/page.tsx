'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import styles from './page.module.css';

type Farmer = {
  id: string;
  memberNumber: string;
  fullName: string;
  centreId: string | null;
  centre?: { name: string } | null;
};

type Allocation = { farmerId: string; quantityKg: number };
type QueuedBatch = {
  id: string;
  referenceNumber: string;
  capturedAt: string;
  totalKg: number;
  allocations: Array<Allocation & { farmerName: string; memberNumber: string }>;
  status: 'WAITING_FOR_SYNC';
};

const queueStorageKey = 'milkos.collection-queue.v1';
const cooperativeId = process.env.NEXT_PUBLIC_COOPERATIVE_ID || '13da2e35-25c2-4f1b-96ea-ac0170ff7e12';
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function NewCollectionPage() {
  const [farmers, setFarmers] = useState<Farmer[]>([]);
  const [loadingFarmers, setLoadingFarmers] = useState(true);
  const [farmerError, setFarmerError] = useState('');
  const [query, setQuery] = useState('');
  const [selectedFarmerId, setSelectedFarmerId] = useState('');
  const [totalKg, setTotalKg] = useState('');
  const [scaleKg, setScaleKg] = useState('');
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [queue, setQueue] = useState<QueuedBatch[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setIsOnline(navigator.onLine);
    try {
      const stored = localStorage.getItem(queueStorageKey);
      if (stored) setQueue(JSON.parse(stored) as QueuedBatch[]);
    } catch {
      setNotice('This device could not read its saved collection queue.');
    }

    const updateConnection = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    return () => {
      window.removeEventListener('online', updateConnection);
      window.removeEventListener('offline', updateConnection);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(queueStorageKey, JSON.stringify(queue));
    } catch {
      setNotice('Storage is full. Export or clear queued records before capturing more.');
    }
  }, [queue]);

  const loadFarmers = useCallback(async () => {
    setLoadingFarmers(true);
    setFarmerError('');
    try {
      const response = await fetch(`${apiUrl}/cooperatives/${cooperativeId}/farmers`);
      if (!response.ok) {
        throw new Error(response.status === 401 || response.status === 403
          ? 'Sign in with an active cooperative account to load its farmer roster.'
          : `Farmer roster could not be loaded (${response.status}).`);
      }
      const result: unknown = await response.json();
      if (!Array.isArray(result)) throw new Error('The farmer roster response was not valid.');
      setFarmers(result as Farmer[]);
    } catch (error) {
      setFarmerError(error instanceof Error ? error.message : 'Farmer roster could not be loaded.');
    } finally {
      setLoadingFarmers(false);
    }
  }, []);

  useEffect(() => {
    void loadFarmers();
  }, [loadFarmers]);

  const total = Number(totalKg) || 0;
  const allocated = allocations.reduce((sum, allocation) => sum + allocation.quantityKg, 0);
  const remaining = Math.round((total - allocated) * 1000) / 1000;
  const overAllocated = remaining < 0;
  const complete = total > 0 && remaining === 0;
  const filteredFarmers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return farmers.filter((farmer) =>
      !allocations.some((allocation) => allocation.farmerId === farmer.id)
      && (!normalized || `${farmer.fullName} ${farmer.memberNumber}`.toLowerCase().includes(normalized)),
    );
  }, [allocations, farmers, query]);

  function addAllocation() {
    if (!selectedFarmerId || allocations.some((allocation) => allocation.farmerId === selectedFarmerId)) return;
    setAllocations((current) => [...current, { farmerId: selectedFarmerId, quantityKg: 0 }]);
    setSelectedFarmerId('');
    setQuery('');
  }

  function changeAllocation(farmerId: string, value: string) {
    const quantityKg = Math.max(0, Number(value) || 0);
    setAllocations((current) => current.map((allocation) =>
      allocation.farmerId === farmerId ? { ...allocation, quantityKg } : allocation,
    ));
  }

  function removeAllocation(farmerId: string) {
    setAllocations((current) => current.filter((allocation) => allocation.farmerId !== farmerId));
  }

  function captureScale() {
    const value = Number(scaleKg);
    if (!Number.isFinite(value) || value <= 0) {
      setNotice('Enter a scale reading above 0 KG before capturing.');
      return;
    }
    setTotalKg(value.toFixed(3).replace(/\.?0+$/, ''));
    setNotice('Scale reading captured. Allocate the full batch to farmers.');
  }

  function saveBatch() {
    if (!complete || allocations.length === 0) return;
    const saved: QueuedBatch = {
      id: makeId(),
      referenceNumber: `MC-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      capturedAt: new Date().toISOString(),
      totalKg: total,
      allocations: allocations.map((allocation) => {
        const farmer = farmers.find((entry) => entry.id === allocation.farmerId)!;
        return { ...allocation, farmerName: farmer.fullName, memberNumber: farmer.memberNumber };
      }),
      status: 'WAITING_FOR_SYNC',
    };
    setQueue((current) => [saved, ...current]);
    setTotalKg('');
    setScaleKg('');
    setAllocations([]);
    setNotice(`${saved.referenceNumber} saved on this device and is waiting for server sync.`);
  }

  function exportQueue() {
    const file = new Blob([JSON.stringify(queue, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'milkos-collection-queue.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className={styles.workspace}>
      <div className={styles.topline}>
        <Link href="/dashboard" className={styles.backLink}>Dashboard</Link>
        <div className={`${styles.connection} ${isOnline ? styles.connected : styles.offline}`}>
          <span aria-hidden="true" />{isOnline ? 'Online' : 'Offline'}
        </div>
      </div>

      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>COLLECTOR WORKSPACE</p>
          <h1>Record milk collection</h1>
          <p className={styles.intro}>Capture one batch, then account for every kilogram across its farmers.</p>
        </div>
        <div className={styles.queueCount}>
          <span>{queue.length}</span>
          <small>waiting to sync</small>
        </div>
      </header>

      {notice && <p className={styles.notice} role="status">{notice}</p>}

      <div className={styles.layout}>
        <section className={styles.captureColumn} aria-label="Collection entry">
          <section className={styles.scalePanel}>
            <div className={styles.sectionHeading}>
              <div><span className={styles.step}>01</span><h2>Scale reading</h2></div>
              <span className={styles.manualLabel}>MANUAL ENTRY</span>
            </div>
            <div className={styles.scaleDisplay}>
              <label htmlFor="scale-reading">Reading</label>
              <div className={styles.weightInput}>
                <input id="scale-reading" type="number" min="0" step="0.001" inputMode="decimal" value={scaleKg} onChange={(event) => setScaleKg(event.target.value)} placeholder="0.000" />
                <span>KG</span>
              </div>
            </div>
            <div className={styles.scaleControls}>
              <button type="button" className={styles.secondaryButton} onClick={() => setScaleKg('')}>Tare</button>
              <button type="button" className={styles.primaryButton} onClick={captureScale}>Capture reading</button>
            </div>
            <p className={styles.scaleFootnote}>Bluetooth scales are not paired. Enter the displayed weight manually.</p>
          </section>

          <section className={styles.allocationPanel}>
            <div className={styles.sectionHeading}>
              <div><span className={styles.step}>02</span><h2>Farmer allocation</h2></div>
              <span className={styles.allocationStatus} data-state={overAllocated ? 'over' : complete ? 'complete' : 'open'}>
                {overAllocated ? 'OVER ALLOCATED' : complete ? 'BALANCED' : 'IN PROGRESS'}
              </span>
            </div>

            <label className={styles.fieldLabel} htmlFor="batch-total">Batch total (KG)</label>
            <input id="batch-total" className={styles.textInput} type="number" min="0" step="0.001" inputMode="decimal" value={totalKg} onChange={(event) => setTotalKg(event.target.value)} placeholder="Capture a reading or enter total" />

            <div className={styles.allocationTotals}>
              <div><span>Total</span><strong>{total.toFixed(3)} <small>KG</small></strong></div>
              <div><span>Allocated</span><strong>{allocated.toFixed(3)} <small>KG</small></strong></div>
              <div className={remaining < 0 ? styles.remainingOver : remaining === 0 && total > 0 ? styles.remainingDone : ''}><span>Remaining</span><strong>{remaining.toFixed(3)} <small>KG</small></strong></div>
            </div>
            <div className={styles.progressTrack} aria-label={`${total > 0 ? Math.max(0, Math.min(100, allocated / total * 100)).toFixed(0) : 0}% allocated`}>
              <span data-state={overAllocated ? 'over' : complete ? 'complete' : 'open'} style={{ width: `${total > 0 ? Math.max(0, Math.min(100, allocated / total * 100)) : 0}%` }} />
            </div>

            <div className={styles.farmerPicker}>
              <label className={styles.fieldLabel} htmlFor="farmer-search">Add farmer</label>
              {farmerError ? (
                <div className={styles.loadError} role="alert">
                  <span>{farmerError}</span>
                  <button type="button" className={styles.inlineButton} onClick={() => void loadFarmers()}>Retry</button>
                </div>
              ) : loadingFarmers ? (
                <div className={styles.loading}>Loading farmer roster...</div>
              ) : farmers.length === 0 ? (
                <div className={styles.emptyState}>No active farmers are available for this cooperative.</div>
              ) : (
                <div className={styles.farmerSearch}>
                  <input id="farmer-search" className={styles.textInput} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or member number" />
                  <select aria-label="Select farmer" value={selectedFarmerId} onChange={(event) => setSelectedFarmerId(event.target.value)}>
                    <option value="">Choose a farmer</option>
                    {filteredFarmers.map((farmer) => <option key={farmer.id} value={farmer.id}>{farmer.fullName} · {farmer.memberNumber}</option>)}
                  </select>
                  <button type="button" className={styles.secondaryButton} onClick={addAllocation} disabled={!selectedFarmerId}>Add farmer</button>
                </div>
              )}
            </div>

            <div className={styles.allocationList}>
              {allocations.map((allocation) => {
                const farmer = farmers.find((entry) => entry.id === allocation.farmerId);
                if (!farmer) return null;
                return (
                  <div className={styles.allocationRow} key={farmer.id}>
                    <div className={styles.farmerIdentity}>
                      <strong>{farmer.fullName}</strong>
                      <span>{farmer.memberNumber}{farmer.centre?.name ? ` · ${farmer.centre.name}` : ''}</span>
                    </div>
                    <label className={styles.quantityField}>
                      <input type="number" min="0" step="0.001" inputMode="decimal" aria-label={`Allocation for ${farmer.fullName} in kilograms`} value={allocation.quantityKg || ''} onChange={(event) => changeAllocation(farmer.id, event.target.value)} placeholder="0.000" />
                      <span>KG</span>
                    </label>
                    <button type="button" className={styles.removeButton} onClick={() => removeAllocation(farmer.id)} aria-label={`Remove ${farmer.fullName}`} title="Remove farmer">×</button>
                  </div>
                );
              })}
              {allocations.length === 0 && <p className={styles.emptyAllocation}>Add farmers to divide this batch.</p>}
            </div>

            <button type="button" className={styles.confirmButton} onClick={saveBatch} disabled={!complete || allocations.length === 0}>
              Save collection batch
            </button>
            {!complete && total > 0 && <p className={styles.submitHint}>Allocate exactly {remaining > 0 ? `${remaining.toFixed(3)} KG more` : `${Math.abs(remaining).toFixed(3)} KG less`} to continue.</p>}
          </section>
        </section>

        <aside className={styles.queuePanel} aria-label="Offline sync queue">
          <div className={styles.queueHeader}>
            <div><p className={styles.eyebrow}>ON THIS DEVICE</p><h2>Sync queue</h2></div>
            {queue.length > 0 && <button type="button" className={styles.exportButton} onClick={exportQueue}>Export</button>}
          </div>
          <p className={styles.queueDescription}>Saved batches stay on this device until an authenticated sync is available.</p>
          {queue.length === 0 ? (
            <div className={styles.queueEmpty}><span className={styles.emptyMark}>0</span><strong>Queue is clear</strong><p>Saved collection batches will appear here.</p></div>
          ) : (
            <div className={styles.queueItems}>
              {queue.map((batch) => (
                <article className={styles.queueItem} key={batch.id}>
                  <div className={styles.queueItemTop}><strong>{batch.referenceNumber}</strong><span>WAITING</span></div>
                  <p>{batch.totalKg.toFixed(3)} KG · {batch.allocations.length} farmer{batch.allocations.length === 1 ? '' : 's'}</p>
                  <time dateTime={batch.capturedAt}>{new Date(batch.capturedAt).toLocaleString()}</time>
                  <button type="button" className={styles.removeQueueButton} onClick={() => setQueue((current) => current.filter((item) => item.id !== batch.id))}>Remove local record</button>
                </article>
              ))}
            </div>
          )}
          <div className={styles.syncNotice}>
            <strong>{isOnline ? 'Server sync not connected' : 'Offline capture enabled'}</strong>
            <p>{isOnline ? 'Records are stored locally. Sign-in and server sync are not yet connected in this frontend.' : 'New batches will be saved locally and can sync when a connection is restored.'}</p>
          </div>
        </aside>
      </div>
    </main>
  );
}