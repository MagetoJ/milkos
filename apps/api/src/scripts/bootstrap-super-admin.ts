/**
 * Grants PLATFORM_SUPER_ADMIN to an email address. This is the ONLY way to
 * create the first Super Admin: there is no API or UI path to self-promote.
 * Later Super Admins can be invited from the admin console.
 *
 *   pnpm --filter @milk/api auth:bootstrap-super-admin -- admin@example.com "Full Name"
 *
 * With SUPABASE_SERVICE_ROLE_KEY set, a new address receives an invitation
 * email. Without it, the person must have signed in once already.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

async function resolveAuthUserId(email: string, displayName?: string): Promise<string | undefined> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return undefined;
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }).auth.admin;
  const webUrl = (process.env.WEB_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const invite = await admin.inviteUserByEmail(email, {
    redirectTo: `${webUrl}/reset-password?invited=1`,
    data: displayName ? { full_name: displayName } : undefined,
  });
  if (invite.data.user) {
    console.log(`Invitation email sent to ${email}.`);
    return invite.data.user.id;
  }
  const existing = await admin.generateLink({ type: 'magiclink', email });
  if (existing.data.user) return existing.data.user.id;
  throw new Error(invite.error?.message || existing.error?.message || 'Supabase could not resolve the user');
}

async function main() {
  const [rawEmail, displayName] = process.argv.slice(2).filter((a) => a !== '--');
  if (!rawEmail || !rawEmail.includes('@')) {
    console.error('Usage: auth:bootstrap-super-admin -- <email> ["Display Name"]');
    process.exit(1);
  }
  const email = rawEmail.trim().toLowerCase();
  const prisma = new PrismaClient();
  try {
    const authUserId = await resolveAuthUserId(email, displayName);
    let user = authUserId
      ? await prisma.user.upsert({
        where: { authUserId },
        create: { authUserId, email, displayName: displayName || email.split('@')[0], platformRole: 'PLATFORM_SUPER_ADMIN' },
        update: { platformRole: 'PLATFORM_SUPER_ADMIN', status: 'ACTIVE' },
      })
      : await prisma.user.findFirst({ where: { email } });
    if (!user) {
      console.error(`No user with ${email} yet. Sign in once in the web app, or set SUPABASE_SERVICE_ROLE_KEY to send an invite.`);
      process.exit(1);
    }
    if (user.platformRole !== 'PLATFORM_SUPER_ADMIN' || user.status !== 'ACTIVE') {
      user = await prisma.user.update({ where: { id: user.id }, data: { platformRole: 'PLATFORM_SUPER_ADMIN', status: 'ACTIVE' } });
    }
    await prisma.auditEvent.create({
      data: {
        actorUserId: null, action: 'PLATFORM_SUPER_ADMIN_BOOTSTRAPPED', entityType: 'User', entityId: user.id,
        result: 'SUCCESS', metadata: { email, via: 'cli' },
      },
    });
    console.log(`${email} is now PLATFORM_SUPER_ADMIN (user ${user.id}). They must enrol TOTP MFA on first sign-in.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
