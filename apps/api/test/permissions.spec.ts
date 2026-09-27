import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORM_PERMISSIONS, TENANT_PERMISSIONS, platformPermissions, tenantPermissions } from '../src/auth/permissions';

test('super admin holds every permission', () => {
  assert.deepEqual(platformPermissions('PLATFORM_SUPER_ADMIN'), [...PLATFORM_PERMISSIONS]);
  assert.deepEqual(tenantPermissions('PLATFORM_SUPER_ADMIN', []), [...TENANT_PERMISSIONS]);
});

test('only super admin can manage platform users', () => {
  assert.ok(!platformPermissions('PLATFORM_ADMIN').includes('platform:users:manage'));
  assert.ok(!platformPermissions('PLATFORM_SUPPORT').includes('platform:users:manage'));
  assert.deepEqual(platformPermissions(null), []);
});

test('platform admin and support are read-only inside tenants', () => {
  for (const role of ['PLATFORM_ADMIN', 'PLATFORM_SUPPORT'] as const) {
    const granted = tenantPermissions(role, []);
    assert.ok(granted.every((p) => p.endsWith(':read')), `${role} got ${granted.join(', ')}`);
  }
});

test('collector can record but not approve or manage', () => {
  const granted = tenantPermissions(null, ['COLLECTOR']);
  assert.ok(granted.includes('collections:create'));
  assert.ok(granted.includes('corrections:request'));
  assert.ok(!granted.includes('corrections:decide'));
  assert.ok(!granted.includes('members:manage'));
  assert.ok(!granted.includes('farmers:manage'));
});

test('farmer has no access to cooperative-wide collection data', () => {
  assert.deepEqual(tenantPermissions(null, ['FARMER']), ['cooperative:read']);
});

test('multiple memberships in one cooperative combine', () => {
  const granted = tenantPermissions(null, ['COLLECTOR', 'ACCOUNTANT']);
  assert.ok(granted.includes('collections:create'));
  assert.ok(granted.includes('sms:purchase'));
});
