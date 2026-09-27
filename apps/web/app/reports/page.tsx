'use client';

import Link from 'next/link';
import { useState } from 'react';
import styles from './page.module.css';

type Report = {
  totalKg: number;
  collectionCount: number;
  farmerCount: number;
  farmers: Array<{ farmerId: string; farmerName: string; memberNumber: string; quantityKg: number; collections: number }>;
  centres: Array<{ centreId: string; centreName: string; quantityKg: number; collections: number }>;
};

const cooperativeId = process.env.NEXT_PUBLIC_COOPERATIVE_ID || '13da2e35-25c2-4f1b-96ea-ac0170ff7e12';
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
const today = new Date().toISOString().slice(0, 10);

export default function ReportsPage() {
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function runReport() {
    setError('');
    setLoading(true);
    try {
      const params = new URLSearchParams({ from, to });
      const response = await fetch(`${apiUrl}/cooperatives/${cooperativeId}/reports/collections?${params}`);
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Sign in with an active cooperative account to view reports.' : `Report request failed (${response.status}).`);
      setReport(await response.json());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Report request failed.');
    } finally {
      setLoading(false);
    }
  }

  async function exportCsv() {
    setError('');
    try {
      const params = new URLSearchParams({ from, to });
      const response = await fetch(`${apiUrl}/cooperatives/${cooperativeId}/reports/collections.csv?${params}`);
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Sign in with an active cooperative account to export reports.' : `Export failed (${response.status}).`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `milk-collections-${from}-to-${to}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Export failed.');
    }
  }

  return (
    <main className={styles.workspace}>
      <div className={styles.topline}><Link href="/dashboard">Dashboard</Link><span>REPORTING</span></div>
      <header><p className={styles.eyebrow}>MILKOS OPERATIONS</p><h1>Collection reports</h1><p>Summaries by farmer and collection centre for a selected period.</p></header>
      <section className={styles.filters}>
        <label>From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>To<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label>
        <button type="button" onClick={() => void runReport()} disabled={loading}>{loading ? 'Loading…' : 'Run report'}</button>
        <button type="button" className={styles.export} onClick={() => void exportCsv()}>Export CSV</button>
      </section>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {!report && !loading ? <section className={styles.empty}><strong>Choose a reporting period</strong><p>Set dates and run the report to view collection totals.</p></section> : null}
      {loading && <section className={styles.loading}>Loading report data…</section>}
      {report && !loading && <>
        <section className={styles.summary}>
          <div><span>TOTAL COLLECTED</span><strong>{report.totalKg.toLocaleString(undefined, { maximumFractionDigits: 3 })} KG</strong></div>
          <div><span>COLLECTIONS</span><strong>{report.collectionCount.toLocaleString()}</strong></div>
          <div><span>FARMERS</span><strong>{report.farmerCount.toLocaleString()}</strong></div>
        </section>
        <section className={styles.tables}>
          <ReportTable title="By farmer" headers={['Farmer', 'Member no.', 'Collections', 'Quantity KG']} rows={report.farmers.map((farmer) => [farmer.farmerName, farmer.memberNumber, farmer.collections, farmer.quantityKg.toFixed(3)])} />
          <ReportTable title="By collection centre" headers={['Centre', 'Collections', 'Quantity KG']} rows={report.centres.map((centre) => [centre.centreName, centre.collections, centre.quantityKg.toFixed(3)])} />
        </section>
      </>}
    </main>
  );
}

function ReportTable({ title, headers, rows }: { title: string; headers: string[]; rows: Array<Array<string | number>> }) {
  return <section className={styles.tableSection}><h2>{title}</h2>{rows.length === 0 ? <p className={styles.noRows}>No collection records in this period.</p> : <div className={styles.tableWrap}><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>}</section>;
}