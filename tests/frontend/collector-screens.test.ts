// Collector and office screens rendered to HTML (no browser needed): what the person sees for the scale,
// allocation, confirmation, success, sync, correction and payment states.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { summarize } from '@/lib/collections/allocation';
import { newDraft, reduceDraft, type CollectionDraft } from '@/lib/collections/draft';
import { AllocationSummaryCard } from '@/app/collector/_components/allocation-summary';
import { syncBadgeState } from '@/app/collector/_components/collector-shell';
import { ScaleDisplay } from '@/app/collector/_components/scale-display';
import { ConfirmBar, ReviewStep, SuccessStep } from '@/app/collector/_components/wizard-steps';
import { RequestDetail } from '@/app/cooperatives/_components/corrections-view';
import { NEXT_STATUSES } from '@/app/cooperatives/_components/payments-view';
import type { ScaleStatus } from '@/lib/scale/types';

const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);
const noop = () => undefined;

const connected: ScaleStatus = {
  state: 'connected', transport: 'SIMULATED', deviceId: 'sim', deviceName: 'Scale simulator (development)',
  batteryPercent: 64, lastSeenAt: null, error: null, capabilities: { tare: true, battery: true, stabilityFlag: false },
};

function draftWith(kg: number, lines: [string, string][]): CollectionDraft {
  let d = newDraft({ id: 'k-1', name: 'Kiserian Cooler', code: 'CLR-001', centre_id: null, centre_name: 'Kiserian Centre' });
  d = reduceDraft(d, { type: 'use_scale', scale: null });
  d = reduceDraft(d, { type: 'capture', weight: { kg, source: 'MANUAL', tare_kg: null, captured_at: new Date().toISOString() } });
  for (const [id, q] of lines) d = reduceDraft(d, { type: 'add_farmer', farmer: { id, full_name: `Farmer ${id}`, farmer_number: `F-${id}` }, quantity_kg: q });
  return d;
}

describe('scale screen', () => {
  it('shows the weight very large with connection, stability, scale name and battery in words', () => {
    const out = html(createElement(ScaleDisplay, { kg: 248.5, stable: true, status: connected }));
    expect(out).toContain('TOTAL WEIGHT');
    expect(out).toContain('248.50');
    expect(out).toMatch(/Connected/);
    expect(out).toMatch(/Stable/);
    expect(out).toContain('Scale simulator (development)');
    expect(out).toContain('Battery 64%');
    expect(html(createElement(ScaleDisplay, { kg: 12, stable: false, status: connected }))).toContain('Unstable');
  });

  it('labels a typed weight as manual, never as a scale reading', () => {
    const out = html(createElement(ScaleDisplay, { kg: 30, stable: true, status: null, manual: true }));
    expect(out).toContain('MANUAL ENTRY');
    expect(out).not.toContain('Connected');
  });
});

describe('allocation screen', () => {
  it('uses green / amber / red states with words, not colour alone', () => {
    expect(html(createElement(AllocationSummaryCard, { summary: summarize(100, draftWith(100, [['a', '100']]).lines) }))).toContain('All weight allocated');
    const amber = html(createElement(AllocationSummaryCard, { summary: summarize(248.5, draftWith(248.5, [['a', '80'], ['b', '65'], ['c', '50']]).lines) }));
    expect(amber).toContain('data-state="remaining"');
    expect(amber).toContain('53.50');
    const red = html(createElement(AllocationSummaryCard, { summary: summarize(100, draftWith(100, [['a', '120']]).lines) }));
    expect(red).toContain('data-state="over"');
    expect(red).toContain('Allocated more than the total weight');
    expect(red).toContain('Over by');
  });
});

describe('confirmation screen', () => {
  it('lists the full summary and the individual allocations', () => {
    const d = draftWith(248.5, [['a', '80'], ['b', '65']]);
    const out = html(createElement(ReviewStep, {
      draft: d, dispatch: noop, cooperativeName: 'Kiserian Dairy', collectorName: 'Col Lector', online: false,
      syncLabel: 'Offline — pending sync after confirming', error: null,
    }));
    for (const text of ['Collection reference', 'Kiserian Dairy', 'Kiserian Centre', 'Kiserian Cooler (CLR-001)', 'Col Lector', 'Manual entry (no scale)', '248.50 KG', '103.50 KG', 'Offline', 'Farmer a', '80.00 KG']) {
      expect(out).toContain(text);
    }
  });

  it('disables Confirm when anything blocks the batch, and while saving', () => {
    const ok = draftWith(100, [['a', '60']]);
    const isDisabled = (markup: string) => /<button[^>]* disabled=""[^>]*>(Saving…|Confirm Collection)</.test(markup);
    expect(isDisabled(html(createElement(ConfirmBar, { draft: ok, submitting: false, onBack: noop, onConfirm: noop })))).toBe(false);
    expect(isDisabled(html(createElement(ConfirmBar, { draft: ok, submitting: true, onBack: noop, onConfirm: noop })))).toBe(true);
    for (const bad of [draftWith(100, [['a', '120']]), draftWith(100, []), draftWith(100, [['a', '']]), { ...ok, cooler: null }]) {
      expect(isDisabled(html(createElement(ConfirmBar, { draft: bad, submitting: false, onBack: noop, onConfirm: noop })))).toBe(true);
    }
  });
});

describe('success screen', () => {
  it('offline: saved on this device, will sync, SMS queued (never "sent")', () => {
    const d = reduceDraft(draftWith(100, [['a', '60'], ['b', '40']]), { type: 'confirmed', result: { id: 'b-1', reference: 'Pending sync' } });
    const out = html(createElement(SuccessStep, { draft: d, syncStatus: 'pending', receiptStatuses: [null, null], onNew: noop }));
    expect(out).toContain('Saved on this device');
    expect(out).toContain('Will sync when connection returns.');
    expect(out).toContain('SMS receipts queued until this collection syncs');
    expect(out).toContain('Pending sync');
    expect(out).toContain('New Collection');
    expect(out).toContain('View Collection');
    expect(out).not.toMatch(/SMS sent/);
  });

  it('synced: shows the reference, totals and the real SMS outcome', () => {
    const d = reduceDraft(draftWith(100, [['a', '60'], ['b', '40']]), { type: 'confirmed', result: { id: 'b-1', reference: 'CB-261004-ABC123' } });
    const out = html(createElement(SuccessStep, { draft: d, syncStatus: 'synced', receiptStatuses: ['SENT', 'PENDING_PROVIDER'], onNew: noop }));
    expect(out).toContain('Collection confirmed');
    expect(out).toContain('CB-261004-ABC123');
    expect(out).toContain('100.00 KG');
    expect(out).toContain('1 of 2 SMS sent · 1 waiting');
    expect(out).toContain('Synced');
  });
});

describe('sync status badge', () => {
  it('says Offline / Pending sync / Syncing / Synced / Sync error', () => {
    expect(syncBadgeState({ offline: true, phase: 'offline', waiting: 2, failed: 0 }).label).toBe('Offline · 2 pending');
    expect(syncBadgeState({ offline: false, phase: 'idle', waiting: 1, failed: 0 }).label).toBe('Pending sync · 1');
    expect(syncBadgeState({ offline: false, phase: 'syncing', waiting: 1, failed: 0 }).label).toBe('Syncing…');
    expect(syncBadgeState({ offline: false, phase: 'idle', waiting: 0, failed: 0 }).label).toBe('Synced');
    expect(syncBadgeState({ offline: false, phase: 'idle', waiting: 0, failed: 2 })).toEqual({ label: 'Sync error · 2', tone: 'red' });
  });
});

describe('correction and payment screens', () => {
  it('shows recorded and proposed values side by side, with changes highlighted', () => {
    const out = html(createElement(RequestDetail, {
      request: {
        id: 'r-1', batch_id: 'b-1', batch_reference: 'CB-1', batch_status: 'CORRECTION_PENDING', request_type: 'CORRECTION',
        status: 'PENDING', reason: 'Scale misread', requested_by: 'u-1', requested_by_name: 'Col Lector', requested_role: 'COLLECTOR',
        reviewed_by_name: null, reviewed_at: null, review_comment: null, resulting_batch_id: null, resulting_batch_reference: null,
        created_at: '2026-10-04T08:00:00',
        original_values: { captured_weight_kg: 150, allocations: [{ farmer_id: 'f-1', quantity_kg: 80 }, { farmer_id: 'f-2', quantity_kg: 65 }] },
        proposed_values: { captured_weight_kg: 150, allocations: [{ farmer_id: 'f-1', quantity_kg: 70 }, { farmer_id: 'f-2', quantity_kg: 75 }] },
        farmer_names: { 'f-1': 'Jane W (F-0001)', 'f-2': 'Peter K (F-0002)' },
      },
    }));
    expect(out).toContain('Scale misread');
    expect(out).toContain('Jane W (F-0001)');
    expect(out).toMatch(/80<\/td><td[^>]*>70/);
    expect(out).toContain('bg-[#FBF1DC]'); // changed rows are highlighted (and the values differ in text)
  });

  it('offers only the payment transitions the server allows; PAID is final', () => {
    expect(NEXT_STATUSES.PENDING).toEqual(['PAID', 'PROCESSING', 'CANCELLED']);
    expect(NEXT_STATUSES.PROCESSING).toEqual(['PAID', 'FAILED']);
    expect(NEXT_STATUSES.PAID).toEqual([]);
    expect(NEXT_STATUSES.CANCELLED).toEqual([]);
  });
});
