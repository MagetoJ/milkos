// Public cooperative application (spec §41): headline, explanation, the listed fields, progress, and the reference
// the applicant needs to check their status later.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import RegisterPage from '@/app/(auth)/register/page';
import { RegisterForm, Submitted, applicationProgress } from '@/app/(auth)/_components/register-form';
import { blankForm, toPayload, validateAll, type OnboardingForm } from '@/app/(auth)/_lib/onboarding-rules';

const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);

const valid: OnboardingForm = {
  cooperative_name: 'Limuru Dairy Farmers Co-op', registration_number: 'CS/12345', kra_pin: 'p051234567z', county: 'Kiambu',
  location: 'Limuru', estimated_daily_liters: '', initial_coolers_count: '',
  admin_full_name: 'Jane Wanjiku', admin_id_number: '28491029', admin_email: 'Jane@Limurudairy.co.ke', admin_phone: '0712 345 678',
  password: 'Fresh#Pass9', confirm_password: 'Fresh#Pass9', additional_info: '',
};

describe('application page (spec §41)', () => {
  const page = html(createElement(RegisterPage));

  it('leads with the required headline and explains what the platform does', () => {
    expect(page).toContain('Manage milk collections with confidence.');
    for (const phrase of ['Tracks every milk collection', 'Manages your farmers', 'Monitors your coolers', 'Works offline', 'SMS receipts', 'pricing and reports']) {
      expect(page).toContain(phrase);
    }
  });

  it('asks for Name, Organization, Email, Phone, ID number, KRA PIN, Location and Additional information', () => {
    for (const label of ['Organization name', '>Name<', '>Email<', '>Phone<', '>ID number<', '>KRA PIN<', '>Location<', 'Additional information']) {
      expect(page).toContain(label);
    }
  });

  it('shows application progress as an accessible progress bar', () => {
    expect(page).toContain('role="progressbar"');
    expect(page).toContain('aria-valuenow="0"');
    expect(page).toContain('0 of 11 required fields done');
  });
});

describe('application progress', () => {
  it('counts only fields that pass validation, per part', () => {
    expect(applicationProgress(blankForm())).toMatchObject({ done: 0, total: 11 });
    const half = { ...blankForm(), cooperative_name: valid.cooperative_name, kra_pin: valid.kra_pin, admin_email: valid.admin_email };
    const p = applicationProgress(half);
    expect(p.done).toBe(3);
    expect(p.steps.map((s) => s.done)).toEqual([2, 1, 0]);
    expect(applicationProgress({ ...half, kra_pin: 'not-a-pin' }).done).toBe(2);
  });

  it('is complete exactly when the form is submittable; optional fields do not count', () => {
    expect(applicationProgress(valid)).toMatchObject({ done: 11, total: 11 });
    expect(validateAll(valid)).toEqual({});
    expect(applicationProgress({ ...valid, confirm_password: 'different' }).done).toBe(10);
    expect(Object.keys(validateAll({ ...valid, confirm_password: 'different' }))).toEqual(['confirm_password']);
  });
});

describe('application payload', () => {
  it('normalises phone, email, KRA PIN and drops empty optionals', () => {
    expect(toPayload(valid)).toMatchObject({
      kra_pin: 'P051234567Z', admin_email: 'jane@limurudairy.co.ke', admin_phone: '+254712345678',
      estimated_daily_liters: null, initial_coolers_count: null, additional_info: null,
    });
  });

  it('renders no password in the markup and a blank form has no error text', () => {
    const form = html(createElement(RegisterForm));
    expect(form).not.toContain('role="alert"');
    expect(form).toContain('type="password"');
    expect(form).not.toMatch(/value="[^"]+"[^>]*type="password"/);
  });
});

describe('after submitting', () => {
  it('shows the application reference, a way to copy it and a link that checks its status', () => {
    const ref = '3f0c8a52-6b0e-4a3f-9d1a-0c1d2e3f4a5b';
    const out = html(createElement(Submitted, { reference: ref, organization: 'Limuru Dairy', email: 'jane@limurudairy.co.ke' }));
    expect(out).toContain(ref);
    expect(out).toContain('Copy reference');
    expect(out).toContain(`/application-status?reference=${ref}`);
    expect(out).toContain('jane@limurudairy.co.ke');
  });

  it('still confirms the submission when the server sent no reference, without a dead link', () => {
    const out = html(createElement(Submitted, { reference: null, organization: 'Limuru Dairy', email: 'a@b.co' }));
    expect(out).toContain('Application submitted');
    expect(out).not.toContain('application-status');
  });
});
