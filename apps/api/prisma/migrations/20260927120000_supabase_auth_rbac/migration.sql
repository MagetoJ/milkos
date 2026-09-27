-- Supabase Auth identity, platform RBAC and enforceable tenant isolation.

-- ---------------------------------------------------------------------------
-- 1. Identity: Supabase auth.users.id replaces the Keycloak subject.
-- ---------------------------------------------------------------------------
CREATE TYPE "PlatformRole" AS ENUM ('PLATFORM_SUPER_ADMIN', 'PLATFORM_ADMIN', 'PLATFORM_SUPPORT');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
ALTER TYPE "MembershipRole" ADD VALUE IF NOT EXISTS 'ACCOUNTANT' AFTER 'COOPERATIVE_MANAGER';

ALTER TABLE "User" RENAME COLUMN "keycloakId" TO "authUserId";
ALTER INDEX "User_keycloakId_key" RENAME TO "User_authUserId_key";
ALTER TABLE "User"
  ADD COLUMN "platformRole" "PlatformRole",
  ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "defaultCooperativeId" TEXT,
  ADD COLUMN "lastSessionId" TEXT,
  ADD COLUMN "lastSignInAt" TIMESTAMP(3);
CREATE INDEX "User_email_idx" ON "User"("email");

ALTER TABLE "Membership"
  ADD COLUMN "invitedBy" TEXT,
  ADD COLUMN "activatedAt" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- 2. Runtime tenant role.
--
-- The migration/owner role (postgres on Supabase, a superuser locally) has
-- BYPASSRLS, so policies never apply to it. Every tenant-scoped request runs
-- `SET LOCAL ROLE milkos_app` inside its transaction; this role has no login,
-- no BYPASSRLS and only the privileges granted below. Privileges are
-- fail-closed: new tables are NOT granted automatically and must be added here
-- together with an RLS policy.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'milkos_app') THEN
    CREATE ROLE milkos_app NOLOGIN NOBYPASSRLS NOINHERIT;
  END IF;
END $$;
GRANT milkos_app TO CURRENT_USER;

GRANT USAGE ON SCHEMA public TO milkos_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "Farmer", "CollectionCentre", "ScaleDevice", "Cooler", "MilkCollection",
  "CorrectionRequest", "ReversalRequest", "PriceTable", "MilkPricing",
  "Notification", "NotificationAttempt", "Membership"
TO milkos_app;
GRANT SELECT, INSERT, UPDATE ON "PaymentVerification", "CooperativeApplication" TO milkos_app;
GRANT SELECT, UPDATE ON "Cooperative", "User" TO milkos_app;
GRANT SELECT ON "SmsPackage" TO milkos_app;
-- Append-only: INSERT ... RETURNING needs SELECT, but never UPDATE/DELETE.
GRANT SELECT, INSERT ON "AuditEvent", "SecurityEvent", "SmsLedgerEntry" TO milkos_app;
-- "RegistrationVerification" and "_prisma_migrations" are intentionally not granted.

-- Policies for tables that were not tenant-protected before.
ALTER TABLE "Cooperative" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CooperativeApplication" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SecurityEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SmsPackage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RegistrationVerification" ENABLE ROW LEVEL SECURITY;

CREATE POLICY cooperative_tenant_policy ON "Cooperative"
  USING ("id" = current_setting('app.current_cooperative_id', true))
  WITH CHECK ("id" = current_setting('app.current_cooperative_id', true));
CREATE POLICY membership_tenant_policy ON "Membership"
  USING ("cooperativeId" = current_setting('app.current_cooperative_id', true))
  WITH CHECK ("cooperativeId" = current_setting('app.current_cooperative_id', true));
CREATE POLICY cooperative_application_tenant_policy ON "CooperativeApplication"
  USING ("cooperativeId" = current_setting('app.current_cooperative_id', true))
  WITH CHECK ("cooperativeId" = current_setting('app.current_cooperative_id', true));
-- A tenant can see the acting user and users who belong to the tenant.
CREATE POLICY user_tenant_policy ON "User"
  USING (
    "id" = current_setting('app.current_user_id', true)
    OR EXISTS (
      SELECT 1 FROM "Membership" m
      WHERE m."userId" = "User"."id"
        AND m."cooperativeId" = current_setting('app.current_cooperative_id', true)
    )
  );
CREATE POLICY security_event_tenant_policy ON "SecurityEvent"
  USING ("cooperativeId" = current_setting('app.current_cooperative_id', true))
  WITH CHECK ("cooperativeId" = current_setting('app.current_cooperative_id', true));
CREATE POLICY sms_package_read_policy ON "SmsPackage" FOR SELECT USING (true);
-- RegistrationVerification: RLS on with no policy = deny for every non-owner role.

-- ---------------------------------------------------------------------------
-- 3. Supabase Data API (PostgREST) lockdown.
--
-- All data access goes through the NestJS API. Supabase grants anon and
-- authenticated full access to new public tables by default; revoke it so a
-- leaked anon key cannot read or write tenant data. Guarded because these
-- roles do not exist on plain PostgreSQL.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END $$;
