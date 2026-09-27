/**
 * Grants (or removes) a platform role for an existing Milkos user. This is how
 * the first Platform Super Admin is created; after that, use the admin API.
 *
 * The person must have signed in to the web app once so their User row exists.
 *
 *   npm --workspace apps/api run auth:grant-role -- admin@example.com PLATFORM_SUPER_ADMIN
 *   npm --workspace apps/api run auth:grant-role -- admin@example.com none
 */
require('dotenv/config');
const { PrismaClient } = require('@prisma/client');

const ROLES = ['PLATFORM_SUPER_ADMIN', 'PLATFORM_ADMIN', 'PLATFORM_SUPPORT'];

async function main() {
  const [identifier, roleArg] = process.argv.slice(2);
  if (!identifier || !roleArg) {
    console.error('Usage: grant-platform-role <email-or-phone> <PLATFORM_SUPER_ADMIN|PLATFORM_ADMIN|PLATFORM_SUPPORT|none>');
    process.exit(1);
  }
  const role = roleArg === 'none' ? null : roleArg.toUpperCase();
  if (role !== null && !ROLES.includes(role)) {
    console.error(`Unknown role ${roleArg}. Expected one of ${ROLES.join(', ')} or none.`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const value = identifier.trim().toLowerCase();
    const users = await prisma.user.findMany({ where: { OR: [{ email: value }, { phone: value.replace(/^\+/, '') }, { phone: value }] } });
    if (users.length === 0) {
      console.error(`No user found for ${identifier}. Ask them to sign in to the web app once, then run this again.`);
      process.exit(1);
    }
    if (users.length > 1) {
      console.error(`${users.length} users match ${identifier}; use a more specific email.`);
      process.exit(1);
    }
    const [user] = users;
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { platformRole: role } }),
      prisma.auditEvent.create({
        data: {
          action: 'PLATFORM_ROLE_CHANGED', entityType: 'User', entityId: user.id, result: 'SUCCESS',
          metadata: { from: user.platformRole, to: role, via: 'cli' },
        },
      }),
    ]);
    console.log(`${user.email || user.phone}: platform role ${user.platformRole || 'none'} -> ${role || 'none'}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
