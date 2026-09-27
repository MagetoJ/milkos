import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessGuard } from '../src/auth/access.guard';
import { PERMISSIONS_KEY, ALLOW_AAL1_KEY, PLATFORM_SCOPE_KEY } from '../src/auth/auth.decorators';
import type { AuthPrincipal, AuthenticatedRequest } from '../src/auth/auth.types';
import type { Permission } from '../src/auth/permissions';

function principal(overrides: Partial<AuthPrincipal> = {}): AuthPrincipal {
  return {
    id: 'user-1', authUserId: 'auth-1', email: 'a@example.com', phone: null, displayName: 'A',
    platformRole: null, defaultCooperativeId: null, aal: 'aal2', signInMethods: ['password'],
    memberships: [], ...overrides,
  };
}

const membership = (cooperativeId: string, role: AuthPrincipal['memberships'][number]['role'], cooperativeStatus = 'APPROVED') => ({
  id: `m-${cooperativeId}-${role}`, cooperativeId, cooperativeName: cooperativeId, cooperativeStatus: cooperativeStatus as any, role, status: 'ACTIVE' as const,
});

function setup(meta: { permissions?: Permission[]; allowAal1?: boolean; platformScope?: boolean }, requireMfa = true, cooperativeCount = 1) {
  const handler = () => undefined;
  if (meta.permissions) Reflect.defineMetadata(PERMISSIONS_KEY, meta.permissions, handler);
  if (meta.allowAal1) Reflect.defineMetadata(ALLOW_AAL1_KEY, true, handler);
  if (meta.platformScope) Reflect.defineMetadata(PLATFORM_SCOPE_KEY, true, handler);
  const events: string[] = [];
  const guard = new AccessGuard(
    new Reflector(),
    { cooperative: { count: async () => cooperativeCount } } as any,
    { security: async (e: { event: string }) => { events.push(e.event); } } as any,
    { requireMfa } as any,
  );
  const run = (req: Partial<AuthenticatedRequest>) => {
    const request = { headers: {}, method: 'GET', ...req } as AuthenticatedRequest;
    const ctx = { getHandler: () => handler, getClass: () => class {}, switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    return guard.canActivate(ctx).then((ok) => ({ ok, request }));
  };
  return { run, events };
}

test('member reaches their own cooperative with the right permission', async () => {
  const { run } = setup({ permissions: ['farmers:read'] });
  const { request } = await run({ user: principal({ memberships: [membership('coop-a', 'COLLECTOR')] }), params: { cooperativeId: 'coop-a' } });
  assert.equal(request.tenant?.cooperativeId, 'coop-a');
});

test('non-member is denied and the attempt is logged', async () => {
  const { run, events } = setup({ permissions: ['farmers:read'] });
  await assert.rejects(run({ user: principal({ memberships: [membership('coop-a', 'COLLECTOR')] }), params: { cooperativeId: 'coop-b' } }), ForbiddenException);
  assert.deepEqual(events, ['TENANT_ACCESS_DENIED']);
});

test('missing permission is denied', async () => {
  const { run, events } = setup({ permissions: ['members:manage'] });
  await assert.rejects(run({ user: principal({ memberships: [membership('coop-a', 'COLLECTOR')] }), params: { cooperativeId: 'coop-a' } }), ForbiddenException);
  assert.deepEqual(events, ['AUTHORIZATION_DENIED']);
});

test('suspended cooperative is not accessible to members', async () => {
  const { run } = setup({ permissions: ['farmers:read'] });
  await assert.rejects(run({ user: principal({ memberships: [membership('coop-a', 'COOPERATIVE_MANAGER', 'SUSPENDED')] }), params: { cooperativeId: 'coop-a' } }), ForbiddenException);
});

test('manager on an aal1 session must step up with MFA', async () => {
  const { run } = setup({ permissions: ['farmers:read'] });
  await assert.rejects(
    run({ user: principal({ aal: 'aal1', memberships: [membership('coop-a', 'COOPERATIVE_MANAGER')] }), params: { cooperativeId: 'coop-a' } }),
    (e: ForbiddenException) => (e.getResponse() as { code: string }).code === 'MFA_REQUIRED',
  );
});

test('collector on aal1 does not need MFA; @AllowWithoutMfa routes skip the check', async () => {
  await setup({ permissions: ['farmers:read'] }).run({ user: principal({ aal: 'aal1', memberships: [membership('coop-a', 'COLLECTOR')] }), params: { cooperativeId: 'coop-a' } });
  await setup({ allowAal1: true, platformScope: true }).run({ user: principal({ aal: 'aal1', platformRole: 'PLATFORM_SUPER_ADMIN' }) });
});

test('conflicting explicit cooperative ids are rejected', async () => {
  const { run } = setup({ permissions: ['farmers:read'] });
  await assert.rejects(
    run({ user: principal({ memberships: [membership('coop-a', 'COLLECTOR'), membership('coop-b', 'COLLECTOR')] }), params: { cooperativeId: 'coop-a' }, body: { cooperativeId: 'coop-b' } }),
    BadRequestException,
  );
});

test('tenant permission without any cooperative selected asks the client to choose', async () => {
  const { run } = setup({ permissions: ['farmers:read'] });
  await assert.rejects(
    run({ user: principal({ memberships: [membership('coop-a', 'COLLECTOR'), membership('coop-b', 'COLLECTOR')] }) }),
    (e: BadRequestException) => (e.getResponse() as { code: string }).code === 'TENANT_REQUIRED',
  );
});

test('single membership is used automatically', async () => {
  const { request } = await setup({ permissions: ['farmers:read'] }).run({ user: principal({ memberships: [membership('coop-a', 'COLLECTOR')] }) });
  assert.equal(request.tenant?.cooperativeId, 'coop-a');
});

test('platform staff enter any existing cooperative; writes are audited', async () => {
  const { run, events } = setup({ permissions: ['farmers:manage'] });
  const { request } = await run({ user: principal({ platformRole: 'PLATFORM_SUPER_ADMIN' }), params: { cooperativeId: 'coop-z' }, method: 'POST' });
  assert.equal(request.tenant?.viaPlatformRole, true);
  assert.deepEqual(events, ['PLATFORM_TENANT_ACCESS']);
});

test('platform admin cannot write inside a tenant', async () => {
  const { run } = setup({ permissions: ['farmers:manage'] });
  await assert.rejects(run({ user: principal({ platformRole: 'PLATFORM_ADMIN' }), params: { cooperativeId: 'coop-z' }, method: 'POST' }), ForbiddenException);
});

test('@PlatformScope ignores the tenant header', async () => {
  const { request } = await setup({ platformScope: true }).run({ user: principal(), headers: { 'x-cooperative-id': 'coop-a' } });
  assert.equal(request.tenant, undefined);
});
