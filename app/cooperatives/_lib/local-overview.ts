// The dashboard's overview computed from this device's local data, for when the server can't be reached.
// Same shape as GET /api/v1/cooperative/overview, with `offline: true` so the screen can say so.
import { userDb } from '@/lib/offline/db';
import { getActiveSession } from '@/lib/offline/session';
import type { Overview } from '../_types/coop-types';

type Row = Record<string, unknown>;

/** Server days are UTC dates (collections.collection_date), so compare in UTC too. */
const utcDay = (offsetDays = 0) => new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10);

export async function localOverview(): Promise<Overview> {
  const db = userDb();
  const session = await getActiveSession();
  const [coop, farmers, centres, coolers, team, collections] = await Promise.all([
    db.cooperative.toCollection().first() as Promise<Row | undefined>,
    db.farmers.toArray() as Promise<Row[]>,
    db.centres.toArray() as Promise<Row[]>,
    db.coolers.toArray() as Promise<Row[]>,
    db.team.toArray() as Promise<Row[]>,
    db.collections.where('collection_date').aboveOrEqual(utcDay(31)).toArray() as Promise<Row[]>,
  ]);

  const active = farmers.filter((f) => f.status === 'ACTIVE');
  const activeCentres = centres.filter((c) => c.status === 'ACTIVE');
  const activeCoolers = coolers.filter((c) => c.status === 'ACTIVE');
  const members = team.filter((m) => m.is_active);
  const accepted = collections.filter((c) => c.quality_status === 'ACCEPTED');
  const sumSince = (day: string) =>
    Math.round(accepted.filter((c) => String(c.collection_date) >= day).reduce((s, c) => s + Number(c.quantity_litres || 0), 0) * 100) / 100;
  const monthStart = `${utcDay().slice(0, 7)}-01`;

  return {
    role: (session?.user.role === 'MANAGER' ? 'MANAGER' : 'COOP_ADMIN'),
    cooperative: {
      name: String(coop?.name ?? session?.user.cooperative_name ?? 'Your cooperative'),
      code: String(coop?.code ?? session?.user.cooperative_code ?? ''),
      county: String(coop?.county ?? ''),
      location: (coop?.location as string | null) ?? null,
      status: String(coop?.status ?? 'ACTIVE'),
      sms_credit_balance: Number(coop?.sms_credit_balance ?? 0),
      estimated_daily_liters: (coop?.estimated_daily_liters as number | null) ?? null,
      created_at: (coop?.created_at as string | null) ?? null,
    },
    farmers: { total: farmers.length, active: active.length, unassigned: active.filter((f) => !f.centre_id).length },
    centres: {
      total: centres.length,
      active: activeCentres.length,
      with_cooler: activeCentres.filter((c) => c.has_cooler).length,
    },
    coolers: { total: activeCoolers.length, operational: activeCoolers.filter((c) => c.is_operational).length },
    team: {
      admins: members.filter((m) => m.role === 'COOP_ADMIN').length,
      managers: members.filter((m) => m.role === 'MANAGER').length,
      collectors: members.filter((m) => m.role === 'COLLECTOR').length,
    },
    milk: {
      today: sumSince(utcDay()),
      week: sumSince(utcDay(6)),
      month: sumSince(monthStart),
      collections_today: collections.filter((c) => c.collection_date === utcDay()).length,
    },
    recent_farmers: [...farmers]
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
      .slice(0, 5)
      .map((f) => ({
        id: String(f.id),
        farmer_number: String(f.farmer_number),
        full_name: String(f.full_name),
        phone: String(f.phone),
        created_at: (f.created_at as string | null) ?? null,
      })),
    offline: true,
  };
}
