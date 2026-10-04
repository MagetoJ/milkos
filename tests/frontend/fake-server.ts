// An in-memory stand-in for the MilkOS API (just the parts the offline platform talks to), installed as
// global fetch. It follows the real protocol: idempotent mutation ids, conflicts on duplicate phones,
// a monotonic change cursor. The backend's own behaviour is tested in backend/tests/test_sync.py.
import { vi } from 'vitest';

type Entity = Record<string, unknown> & { id: string };

export interface FakeServer {
  reachable: boolean;
  /** Respond 500 to the next N push requests. */
  failPushes: number;
  /** Respond 401 to sync calls until the token is refreshed. */
  expireToken: boolean;
  entities: Map<string, Entity>; // key: `${type}:${id}`
  changes: { seq: number; entity_type: string; entity_id: string }[];
  applied: Map<string, { status: string; server_id: string }>;
  pushes: number;
  smsSent: string[];
  put(type: string, data: Entity): void;
  calls: string[];
}

const COOP = 'coop-1';
export const USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'admin@a.coop',
  full_name: 'Ann Admin',
  role: 'COOP_ADMIN' as const,
  cooperative_id: COOP,
  cooperative_name: 'Kiserian Dairy',
  cooperative_code: 'KISERIAN-1A2B',
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fakeJwt(exp = Math.floor(Date.now() / 1000) + 900) {
  const payload = Buffer.from(JSON.stringify({ sub: USER.id, email: USER.email, role: USER.role, exp })).toString('base64url');
  return `h.${payload}.s`;
}

export function installFakeServer(): FakeServer {
  let seq = 0;
  let farmerNumber = 0;
  const server: FakeServer = {
    reachable: true,
    failPushes: 0,
    expireToken: false,
    entities: new Map(),
    changes: [],
    applied: new Map(),
    pushes: 0,
    smsSent: [],
    calls: [],
    put(type, data) {
      server.entities.set(`${type}:${data.id}`, data);
      server.changes.push({ seq: ++seq, entity_type: type, entity_id: data.id });
    },
  };
  server.put('cooperative', { id: COOP, name: USER.cooperative_name, code: USER.cooperative_code, county: 'Kajiado', status: 'ACTIVE', sms_credit_balance: 50 });

  const session = () => ({
    token: 'device-secret-' + seq,
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    device: { device_identifier: 'x' },
    user: USER,
    permissions: ['farmer.create', 'farmer.update', 'collection.create', 'cooler.read'],
  });

  function applyMutation(m: Record<string, unknown>) {
    const id = String(m.local_id);
    const p = m.payload as Record<string, unknown>;
    const done = server.applied.get(String(m.mutation_id));
    const base = { mutation_id: m.mutation_id, entity_type: m.entity_type, local_id: id };
    if (done) {
      const type = m.entity_type === 'sensor_event' ? 'sensor' : String(m.entity_type);
      return { ...base, status: 'duplicate', server_id: done.server_id, entity: server.entities.get(`${type}:${done.server_id}`) ?? null, error: null };
    }
    if (m.entity_type === 'farmer' && m.operation === 'create') {
      const taken = [...server.entities.values()].some((e) => e.phone === p.phone && e.farmer_number);
      if (taken) {
        return { ...base, status: 'conflict', entity: null, error: { code: 'conflict', message: 'A farmer with this phone number is already registered in this cooperative.', fields: { phone: 'Duplicate phone' } } };
      }
      const entity = { ...p, id, cooperative_id: COOP, farmer_number: `F-${String(++farmerNumber).padStart(4, '0')}`, full_name: `${p.first_name} ${p.last_name}`, status: 'ACTIVE', sync_version: 1 } as Entity;
      server.put('farmer', entity);
      server.applied.set(String(m.mutation_id), { status: 'applied', server_id: id });
      return { ...base, status: 'applied', server_id: id, server_version: 1, entity, error: null };
    }
    if (m.entity_type === 'collection') {
      if (!server.entities.has(`farmer:${p.farmer_id}`)) {
        return { ...base, status: 'rejected', entity: null, error: { code: 'validation', message: 'Choose a farmer from this cooperative.', fields: { farmer_id: 'Choose a farmer' } } };
      }
      const entity = { ...p, id, reference: `MC-${id.slice(0, 6)}`, cooperative_id: COOP, quality_status: 'ACCEPTED', sync_version: 1 } as Entity;
      server.put('collection', entity);
      server.applied.set(String(m.mutation_id), { status: 'applied', server_id: id });
      return { ...base, status: 'applied', server_id: id, entity, error: null };
    }
    if (m.entity_type === 'cooler_reading') {
      const entity = { ...p, id, quality: p.source === 'SIMULATED' ? 'SIMULATED' : 'VALID', quality_flags: [], received_at: new Date().toISOString() } as Entity;
      server.put('cooler_reading', entity);
      server.applied.set(String(m.mutation_id), { status: 'applied', server_id: id });
      const cooler = server.entities.get(`cooler:${p.cooler_id}`);
      if (cooler) {
        server.put('cooler', { ...cooler, current_volume_litres: p.volume_litres, last_reading_at: p.measured_at });
        const low = cooler.low_volume_alert_litres as number | undefined;
        if (low != null && Number(p.volume_litres) < low) server.smsSent.push(String(cooler.name));
      }
      return { ...base, status: 'applied', server_id: id, entity, error: null };
    }
    return { ...base, status: 'rejected', entity: null, error: { code: 'validation', message: 'unsupported', fields: {} } };
  }

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init.method ?? 'GET').toUpperCase();
    server.calls.push(`${method} ${url.pathname}`);
    if (!server.reachable) throw new TypeError('Failed to fetch');
    const body = init.body ? JSON.parse(String(init.body)) : null;
    const path = url.pathname;

    if (path === '/api/v1/health') return json(200, { status: 'ok' });
    if (path === '/api/v1/auth/me') return json(200, { user_id: USER.id, email: USER.email, full_name: USER.full_name, role: USER.role, cooperative_id: COOP, permissions: [] });
    if (path === '/api/v1/devices/register') return json(200, { offline_session: session() });
    if (path === '/api/v1/devices/session/refresh') {
      server.expireToken = false;
      return json(200, { access_token: fakeJwt(), role: USER.role, user_id: USER.id, offline_session: session() });
    }
    if (path.startsWith('/api/v1/sync/') && server.expireToken) return json(401, { detail: 'Invalid or expired authentication token' });
    if (path === '/api/v1/sync/pull') {
      const cursor = Number(url.searchParams.get('cursor') ?? 0);
      const latest = new Map<string, { seq: number; entity_type: string; entity_id: string }>();
      for (const c of server.changes.filter((c) => c.seq > cursor)) latest.set(`${c.entity_type}:${c.entity_id}`, c);
      const changes = [...latest.values()].map((c) => ({ ...c, op: 'upsert', data: server.entities.get(`${c.entity_type}:${c.entity_id}`) }));
      return json(200, { changes, cursor: seq, has_more: false, server_time: new Date().toISOString(), window: { collection_days: 30, reading_days: 7, notification_days: 30 } });
    }
    if (path === '/api/v1/sync/push') {
      server.pushes += 1;
      if (server.failPushes > 0) {
        server.failPushes -= 1;
        return new Response('Internal Server Error', { status: 500 });
      }
      return json(200, { results: body.mutations.map(applyMutation), cursor: seq, server_time: new Date().toISOString() });
    }
    if (path === '/api/v1/sync/status') return json(200, { status: 'ok', cursor: seq, offline_session_expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(), open_conflicts: 0, last_24h: {} });
    if (path === '/api/v1/sync/conflicts/resolve') return json(200, { resolved: true });
    return json(404, { detail: `No fake route for ${method} ${path}` });
  });
  vi.stubGlobal('fetch', fetchMock);
  localStorage.setItem('milkflow_token', fakeJwt());
  return server;
}

export { fakeJwt };
