'use client';

// Reporting center: pick a report and a date range, view it, export CSV or Excel. Reports only ever contain
// this cooperative's data (the server decides the scope from your account).
import { useState } from 'react';
import { Download, FileBarChart } from 'lucide-react';
import { DataTable, EmptyState, FilterBar, FilterDate, FilterSelect, PageHeader, StatCard, secondaryButton, type Column } from '@/components/admin';
import { humanize, isoDay } from '@/lib/format';
import { useResource } from '@/lib/hooks/use-resource';
import { reportCatalogue, reportDownloadUrl, runReport } from '../_api/finance-client';

const STATUS_FILTERS: Record<string, string[]> = {
  sms: ['SENT', 'FAILED', 'REFUNDED', 'PENDING_PROVIDER', 'SKIPPED'],
  payments: ['PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED'],
  corrections: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
  reversals: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
  sync: ['APPLIED', 'REJECTED', 'CONFLICT'],
};

export function ReportsView() {
  const catalogue = useResource(reportCatalogue, []);
  const [kind, setKind] = useState('summary');
  const today = new Date();
  const [from, setFrom] = useState(isoDay(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(isoDay(today));
  const [status, setStatus] = useState('');
  const [quality, setQuality] = useState('');
  const params = { date_from: from, date_to: to, ...(status ? { status } : {}), ...(quality && kind === 'collections' ? { quality_status: quality } : {}) };
  const report = useResource(() => runReport(kind, params), [kind, JSON.stringify(params)]);
  const r = report.data;
  const columns: Column<Record<string, unknown>>[] = (r?.columns ?? []).map((c, i) => ({
    key: c.key,
    header: c.label,
    align: typeof r?.rows[0]?.[c.key] === 'number' ? 'right' : undefined,
    cell: (row) => {
      const v = row[c.key];
      if (v === null || v === undefined || v === '') return <span className="text-[#8A968F]">–</span>;
      if (typeof v === 'boolean') return v ? 'Yes' : 'No';
      return i === 0 ? <span className="font-medium">{String(v)}</span> : String(v);
    },
  }));

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Collections, farmers, coolers, SMS, payments, corrections and more, for any date range."
        action={r && (
          <>
            <a className={secondaryButton} href={reportDownloadUrl(kind, params, 'csv')} download>
              <Download aria-hidden className="size-4" /> CSV
            </a>
            <a className={secondaryButton} href={reportDownloadUrl(kind, params, 'xlsx')} download>
              <Download aria-hidden className="size-4" /> Excel
            </a>
          </>
        )}
      />
      <div className="mb-4 rounded-xl border border-[#DDE3DE] bg-white px-4 py-3">
        <FilterBar>
          <FilterSelect
            label="Report"
            value={kind}
            onChange={(v) => (setKind(v || 'summary'), setStatus(''))}
            allLabel="Cooperative summary"
            options={(catalogue.data ?? []).filter((c) => c.available && c.kind !== 'summary').map((c) => ({ value: c.kind, label: c.title }))}
          />
          <FilterDate label="From" value={from} onChange={setFrom} />
          <FilterDate label="To" value={to} onChange={setTo} />
          {STATUS_FILTERS[kind] && (
            <FilterSelect label="Status" value={status} onChange={setStatus} allLabel="Any status" options={STATUS_FILTERS[kind].map((s) => ({ value: s, label: humanize(s) }))} />
          )}
          {kind === 'collections' && (
            <FilterSelect label="Quality" value={quality} onChange={setQuality} allLabel="Any quality"
              options={[{ value: 'ACCEPTED', label: 'Accepted' }, { value: 'REJECTED', label: 'Rejected' }, { value: 'PENDING', label: 'Pending lab' }]} />
          )}
        </FilterBar>
      </div>
      {r && Object.keys(r.summary).length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {Object.entries(r.summary).map(([k, v]) => <StatCard key={k} label={humanize(k)} value={v === null ? '–' : String(v)} />)}
        </div>
      )}
      {r?.truncated && <p className="mb-3 text-sm text-[#8A5A0B]">Showing the first {r.row_count.toLocaleString()} rows. Narrow the date range for the rest.</p>}
      <DataTable
        columns={columns}
        rows={r?.rows as Record<string, unknown>[] | undefined}
        rowKey={(row) => JSON.stringify(row).slice(0, 200) + String(r?.rows.indexOf(row as never))}
        loading={report.loading}
        error={report.error}
        onRetry={report.reload}
        caption={r?.title}
        mobileCards
        empty={<EmptyState icon={<FileBarChart className="size-8" />} title="No rows for this period" />}
      />
    </>
  );
}
