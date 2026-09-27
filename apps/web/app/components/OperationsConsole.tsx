'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import styles from './OperationsConsole.module.css';
import { apiRequest, toApiError } from '../../lib/api';
import { NoCooperative, useAuth } from './AuthProvider';

type ConsoleMode = 'coolers' | 'pricing' | 'sms' | 'payments' | 'corrections' | 'reversals';
type RecordRow = Record<string, unknown>;

const config = (cooperativeId: string): Record<ConsoleMode, { title: string; subtitle: string; endpoint: string }> => ({
  coolers: { title: 'Cooler directory', subtitle: 'Register collection coolers and pair scale devices.', endpoint: `/cooperatives/${cooperativeId}/coolers` },
  pricing: { title: 'Milk pricing', subtitle: 'Schedule per-kilogram prices by cooperative or cooler.', endpoint: `/cooperatives/${cooperativeId}/pricing` },
  sms: { title: 'SMS credits', subtitle: 'Review ledger-derived credit balance and submit M-Pesa purchases.', endpoint: `/cooperatives/${cooperativeId}/sms/ledger` },
  payments: { title: 'Payment verification', subtitle: 'Review submitted M-Pesa references for this cooperative.', endpoint: `/admin/payments?cooperativeId=${encodeURIComponent(cooperativeId)}` },
  corrections: { title: 'Corrections queue', subtitle: 'Review requests to change recorded milk quantities.', endpoint: `/collections/corrections/pending?cooperativeId=${encodeURIComponent(cooperativeId)}` },
  reversals: { title: 'Reversals queue', subtitle: 'Review requests to reverse confirmed collection records.', endpoint: `/collections/reversals/pending?cooperativeId=${encodeURIComponent(cooperativeId)}` },
});

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function OperationsConsole({ mode }: { mode: ConsoleMode }) {
  const { cooperativeId } = useAuth();
  if (!cooperativeId) return <NoCooperative />;
  return <Console key={cooperativeId} mode={mode} cooperativeId={cooperativeId} />;
}

function Console({ mode, cooperativeId }: { mode: ConsoleMode; cooperativeId: string }) {
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [packages, setPackages] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const page = config(cooperativeId)[mode];

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await apiRequest(page.endpoint);
      if (!response.ok) throw await toApiError(response);
      const data = await response.json();
      if (mode === 'sms') {
        setRows(Array.isArray(data.entries) ? data.entries : []);
        setBalance(Number(data.balance) || 0);
        const packageResponse = await apiRequest('/sms/packages');
        if (packageResponse.ok) {
          const available = await packageResponse.json();
          setPackages(Array.isArray(available) ? available : []);
        }
      } else {
        setRows(Array.isArray(data) ? data : []);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load this view.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [mode]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');
    const form = new FormData(event.currentTarget);
    let endpoint = page.endpoint;
    let method = 'POST';
    let payload: Record<string, unknown> = {};

    if (mode === 'coolers') {
      payload = { name: form.get('name'), serialNumber: form.get('serialNumber'), locationLabel: form.get('locationLabel') };
    } else if (mode === 'pricing') {
      payload = { coolerId: form.get('coolerId') || undefined, effectiveFrom: form.get('effectiveFrom'), effectiveTo: form.get('effectiveTo') || undefined, pricePerKg: Number(form.get('pricePerKg')), currency: 'KES' };
    } else if (mode === 'sms') {
      payload = { packageId: form.get('packageId'), mpesaReference: form.get('mpesaReference'), amountPaid: Number(form.get('amountPaid')), payerPhone: form.get('payerPhone') };
    } else if (mode === 'payments') {
      const paymentId = String(form.get('paymentId'));
      endpoint = `/admin/payments/${encodeURIComponent(paymentId)}/decision`;
      payload = { cooperativeId, status: form.get('status'), rejectionReason: form.get('rejectionReason') };
    } else {
      const requestId = String(form.get('requestId'));
      endpoint = `/collections/${mode}/${encodeURIComponent(requestId)}/decision`;
      payload = { cooperativeId, status: form.get('status'), reason: form.get('reason') };
    }

    const formElement = event.currentTarget;
    try {
      const response = await apiRequest(endpoint, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) throw await toApiError(response);
      setMessage(mode === 'sms' ? 'Payment submitted for verification. SMS credits are added after approval.' : mode === 'payments' ? 'Payment decision recorded.' : mode === 'corrections' || mode === 'reversals' ? 'Approval decision recorded.' : 'Changes saved.');
      formElement.reset();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request failed.');
    } finally {
      setSaving(false);
    }
  }

  const columns = mode === 'coolers'
    ? ['name', 'serialNumber', 'locationLabel', 'active']
    : mode === 'pricing'
      ? ['effectiveFrom', 'effectiveTo', 'pricePerKg', 'currency', 'coolerId']
      : mode === 'sms'
        ? ['createdAt', 'type', 'credits', 'reference']
        : mode === 'payments'
          ? ['createdAt', 'mpesaReference', 'amountPaid', 'payerPhone', 'status']
          : ['createdAt', 'collectionId', 'requestedBy', 'originalQuantityKg', 'requestedQuantityKg', 'reason'];

  return (
    <main className={styles.workspace}>
      <div className={styles.topline}><Link href="/dashboard">Dashboard</Link><span>OPERATIONS</span></div>
      <header className={styles.heading}><div><p className={styles.eyebrow}>MILKOS OPERATIONS</p><h1>{page.title}</h1><p>{page.subtitle}</p></div></header>
      {error && <div className={styles.error} role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>Retry</button></div>}
      {message && <p className={styles.success} role="status">{message}</p>}

      {mode === 'sms' && <section className={styles.balance}><span>AVAILABLE CREDITS</span><strong>{balance === null ? '—' : balance.toLocaleString()}</strong><small>Balance is calculated from the SMS ledger.</small></section>}

      {(mode === 'coolers' || mode === 'pricing' || mode === 'sms') && (
        <section className={styles.formSection}>
          <h2>{mode === 'coolers' ? 'Register cooler' : mode === 'pricing' ? 'Add price schedule' : 'Submit M-Pesa payment'}</h2>
          <form className={styles.form} onSubmit={submit}>
            {mode === 'coolers' && <>
              <label>Cooler name<input name="name" required maxLength={120} /></label>
              <label>Serial number<input name="serialNumber" required maxLength={100} /></label>
              <label>Location label<input name="locationLabel" maxLength={120} /></label>
            </>}
            {mode === 'pricing' && <>
              <label>Price per KG (KES)<input name="pricePerKg" type="number" required min="0.01" step="0.01" /></label>
              <label>Effective from<input name="effectiveFrom" type="date" required /></label>
              <label>Effective to<input name="effectiveTo" type="date" /></label>
              <label>Cooler ID (optional)<input name="coolerId" /></label>
            </>}
            {mode === 'sms' && <>
              <label>Package<select name="packageId" required defaultValue=""><option value="" disabled>Select package</option>{packages.map((item) => <option key={String(item.id)} value={String(item.id)}>{String(item.name)} · {Number(item.smsCount).toLocaleString()} SMS · {String(item.currency)} {String(item.price)}</option>)}</select></label>
              <label>M-Pesa reference<input name="mpesaReference" required maxLength={80} autoCapitalize="characters" /></label>
              <label>Amount paid<input name="amountPaid" type="number" required min="0.01" step="0.01" /></label>
              <label>Payer phone<input name="payerPhone" type="tel" required maxLength={24} /></label>
            </>}
            <button type="submit" disabled={saving}>{saving ? 'Saving…' : mode === 'sms' ? 'Submit for verification' : 'Save'}</button>
          </form>
        </section>
      )}

      <section className={styles.tableSection}>
        <div className={styles.tableHeading}><h2>{mode === 'payments' ? 'Pending verification' : mode === 'sms' ? 'Recent ledger entries' : mode === 'pricing' ? 'Price schedules' : mode === 'corrections' ? 'Pending corrections' : mode === 'reversals' ? 'Pending reversals' : 'Registered coolers'}</h2><button type="button" onClick={() => void load()} aria-label="Refresh records" title="Refresh records">↻</button></div>
        {loading ? <div className={styles.loading}>Loading records…</div> : rows.length === 0 ? <div className={styles.empty}><strong>Nothing to show yet</strong><p>{mode === 'payments' || mode === 'corrections' || mode === 'reversals' ? 'There are no pending requests for this cooperative.' : 'Records will appear here after they are added.'}</p></div> : (
          <div className={styles.tableWrap}><table><thead><tr>{columns.map((column) => <th key={column}>{column.replace(/[A-Z]/g, (letter) => ` ${letter}`).toUpperCase()}</th>)}{(mode === 'payments' || mode === 'corrections' || mode === 'reversals') && <th>DECISION</th>}</tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}>{columns.map((column) => <td key={column}>{displayValue(row[column])}</td>)}{(mode === 'payments' || mode === 'corrections' || mode === 'reversals') && <td><form className={styles.decisionForm} onSubmit={submit}><input type="hidden" name={mode === 'payments' ? 'paymentId' : 'requestId'} value={String(row.id)} />{mode === 'payments' && <input type="hidden" name="rejectionReason" value="Reference could not be verified" />}{(mode === 'corrections' || mode === 'reversals') && <input type="hidden" name="reason" value="Reviewed by cooperative manager" />}<button name="status" value="APPROVED" type="submit" disabled={saving}>Approve</button><button name="status" value="REJECTED" type="submit" disabled={saving}>Reject</button></form></td>}</tr>)}</tbody></table></div>
        )}
      </section>
    </main>
  );
}