// Account settings and security on the device: what may be cached offline (never secrets), phone masking and
// masked local search, one-time tokens read from the URL fragment, password rules, SMS wording and offline gating.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { passwordProblems, tokenFromLocation } from '@/lib/account/api';
import { cacheAccount, readCachedAccount, stripSecrets } from '@/lib/account/cache';
import { smsOutcomeMessage, accountState } from '@/components/accounts/account-status';
import { NeedsConnection } from '@/components/settings/settings-ui';
import { confirmBlockers, type AllocationLine } from '@/lib/collections/allocation';
import { maskPhone } from '@/lib/format';
import { metaDb } from '@/lib/offline/db';
import { farmerMatches, maskedPhoneMatches } from '@/lib/offline/repositories';
import { withCleanState } from './helpers';

withCleanState();

const SECRET_KEYS = ['access_token', 'password', 'current_password', 'new_password', 'code', 'token', 'secret', 'otpauth_uri', 'recovery_codes', 'mfa_token'];

describe('offline account cache', () => {
  it('strips every secret-bearing key, at any depth', () => {
    const cleaned = stripSecrets({
      id: 'u1', full_name: 'Paul', access_token: 'jwt', nested: { token: 't', ok: 1, list: [{ code: '123456', keep: true }] },
    });
    expect(cleaned).toEqual({ id: 'u1', full_name: 'Paul', nested: { ok: 1, list: [{ keep: true }] } });
  });

  it('caches profile and preferences without ever writing a secret to IndexedDB', async () => {
    const profile = {
      id: 'u1', full_name: 'Paul Collector', email: null, phone: '+254711222333', phone_masked: '0711••••33', phone_verified: true,
      access_token: 'eyJhbGciOi.secret.jwt', recovery_codes: ['AAAA-BBBB'],
    } as never;
    await cacheAccount('u1', { profile, preferences: { notifications: [], work: { dashboard_range: '7d' } } });
    const cached = await readCachedAccount('u1');
    expect(cached?.profile?.full_name).toBe('Paul Collector');
    expect(cached?.preferences?.work.dashboard_range).toBe('7d');
    // Scan everything the meta database holds.
    const dump = JSON.stringify(await metaDb().kv.toArray());
    expect(dump).not.toContain('eyJhbGciOi');
    expect(dump).not.toContain('AAAA-BBBB');
    for (const key of SECRET_KEYS) expect(dump).not.toContain(`"${key}"`);
  });
});

describe('phone numbers', () => {
  it('masks numbers the way the server does', () => {
    expect(maskPhone('+254712345656')).toBe('0712••••56');
    expect(maskPhone('0112345678')).toBe('0112••••78');
    expect(maskPhone('')).toBe('');
  });

  it('lets a collector search masked numbers by the digits the device holds', () => {
    expect(maskedPhoneMatches('0712••••56', '712')).toBe(true);
    expect(maskedPhoneMatches('0712••••56', '712345656')).toBe(true);
    expect(maskedPhoneMatches('0712••••56', '712345699')).toBe(false);
    expect(maskedPhoneMatches('0712••••56', '799')).toBe(false);
    const farmer = { first_name: 'Jane', last_name: 'Wanjiku', farmer_number: 'F-0001', phone_masked: '0712••••56' };
    expect(farmerMatches(farmer, '0712345656')).toBe(true);
    expect(farmerMatches(farmer, 'jane')).toBe(true);
    expect(farmerMatches(farmer, '0799123456')).toBe(false);
  });
});

describe('one-time links', () => {
  it('reads the token from the URL fragment (never sent to a server)', () => {
    const win = globalThis.window as unknown as { location: { hash?: string; pathname: string; search: string } };
    win.location.hash = '#t=abcDEF123_-xyz';
    expect(tokenFromLocation()).toBe('abcDEF123_-xyz');
    win.location.hash = '';
    expect(tokenFromLocation()).toBe('');
  });

  it('applies the password rules before anything is sent', () => {
    expect(passwordProblems('short')).toContain('At least 8 characters');
    expect(passwordProblems('alllowercase1')).toContain('An uppercase letter');
    expect(passwordProblems('Good#Pass2026')).toEqual([]);
  });
});

describe('administrator wording', () => {
  it('never claims an SMS was delivered when the provider only accepted (or refused) it', () => {
    expect(smsOutcomeMessage({ sms_sent: true, sms_status: 'SENT', sms_error: null }).text).toMatch(/accepted by the provider/);
    expect(smsOutcomeMessage({ sms_sent: true, sms_status: 'SENT', sms_error: null }).text).not.toMatch(/delivered/i);
    const failed = smsOutcomeMessage({ sms_sent: false, sms_status: 'PENDING_PROVIDER', sms_error: 'SMS provider not configured' });
    expect(failed.ok).toBe(false);
    expect(failed.text).toMatch(/could not be sent: SMS provider not configured/);
  });

  it('derives the account state, never showing a disabled account as active', () => {
    expect(accountState({ account_status: 'PENDING_ACTIVATION', is_active: false })).toBe('PENDING_ACTIVATION');
    expect(accountState({ is_active: false })).toBe('DISABLED');
    expect(accountState({ is_active: true })).toBe('ACTIVE');
  });

  it('marks security actions as needing a connection when offline', () => {
    expect(renderToStaticMarkup(createElement(NeedsConnection, { online: false }))).toMatch(/can.*t be done offline/);
    expect(renderToStaticMarkup(createElement(NeedsConnection, { online: true }))).toBe('');
  });
});

describe('exact allocation', () => {
  const line = (id: string, kg: string): AllocationLine => ({ line_id: id, farmer_id: id, farmer_name: id, farmer_number: id, quantity_kg: kg });
  it('blocks under- and over-allocation and accepts exact totals', () => {
    const base = { totalKg: 50, coolerId: 'k', weightSource: 'SCALE' };
    expect(confirmBlockers({ ...base, lines: [line('a', '25'), line('b', '25')] })).toEqual([]);
    expect(confirmBlockers({ ...base, lines: [line('a', '25')] }).join(' ')).toMatch(/25\.00 KG is not allocated/);
    expect(confirmBlockers({ ...base, lines: [line('a', '50.01')] }).join(' ')).toMatch(/more than the total/);
  });
});
