-- Production migration pattern. The application must set app.current_cooperative
-- from the authenticated membership, never from an untrusted client field.
ALTER TABLE "MilkCollection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Farmer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CollectionCentre" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditEvent" ENABLE ROW LEVEL SECURITY;

CREATE POLICY milk_collection_tenant_policy ON "MilkCollection"
  USING ("cooperativeId"::text = current_setting('app.current_cooperative', true));
CREATE POLICY farmer_tenant_policy ON "Farmer"
  USING ("cooperativeId"::text = current_setting('app.current_cooperative', true));
CREATE POLICY centre_tenant_policy ON "CollectionCentre"
  USING ("cooperativeId"::text = current_setting('app.current_cooperative', true));
CREATE POLICY notification_tenant_policy ON "Notification"
  USING ("cooperativeId"::text = current_setting('app.current_cooperative', true));
CREATE POLICY audit_tenant_policy ON "AuditEvent"
  USING ("cooperativeId"::text = current_setting('app.current_cooperative', true));
