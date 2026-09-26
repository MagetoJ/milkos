ALTER TABLE "MilkCollection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MilkCollection" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Farmer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Farmer" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CollectionCentre" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CollectionCentre" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ScaleDevice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScaleDevice" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PriceTable" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PriceTable" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AuditEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditEvent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CorrectionRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CorrectionRequest" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ReversalRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReversalRequest" FORCE ROW LEVEL SECURITY;
ALTER TABLE "NotificationAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationAttempt" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS milk_collection_tenant_policy ON "MilkCollection";
DROP POLICY IF EXISTS farmer_tenant_policy ON "Farmer";
DROP POLICY IF EXISTS centre_tenant_policy ON "CollectionCentre";
DROP POLICY IF EXISTS scale_device_tenant_policy ON "ScaleDevice";
DROP POLICY IF EXISTS price_table_tenant_policy ON "PriceTable";
DROP POLICY IF EXISTS notification_tenant_policy ON "Notification";
DROP POLICY IF EXISTS audit_tenant_policy ON "AuditEvent";
DROP POLICY IF EXISTS correction_request_tenant_policy ON "CorrectionRequest";
DROP POLICY IF EXISTS reversal_request_tenant_policy ON "ReversalRequest";
DROP POLICY IF EXISTS notification_attempt_tenant_policy ON "NotificationAttempt";

CREATE POLICY milk_collection_tenant_policy ON "MilkCollection"
  USING ("cooperativeId"::text = current_setting('app.current_cooperative_id', true))
  WITH CHECK ("cooperativeId"::text = current_setting('app.current_cooperative_id', true));
CREATE POLICY farmer_tenant_policy ON "Farmer"
  USING ("cooperativeId"::text = current_setting('app.current_cooperative_id', true))
  WITH CHECK ("cooperativeId"::text = current_setting('app.current_cooperative_id', true));
CREATE POLICY centre_tenant_policy ON "CollectionCentre"
  USING ("cooperativeId"::text = current_setting('app.current_cooperative_id', true))
  WITH CHECK ("cooperativeId"::text = current_setting('app.current_cooperative_id', true));
CREATE POLICY scale_device_tenant_policy ON "ScaleDevice"
  USING ("cooperativeId"::text = current_setting('app.current_cooperative_id', true))
  WITH CHECK ("cooperativeId"::text = current_setting('app.current_cooperative_id', true));
CREATE POLICY price_table_tenant_policy ON "PriceTable"
  USING ("cooperativeId"::text = current_setting('app.current_cooperative_id', true))
  WITH CHECK ("cooperativeId"::text = current_setting('app.current_cooperative_id', true));
CREATE POLICY notification_tenant_policy ON "Notification"
  USING ("cooperativeId"::text = current_setting('app.current_cooperative_id', true))
  WITH CHECK ("cooperativeId"::text = current_setting('app.current_cooperative_id', true));
CREATE POLICY audit_tenant_policy ON "AuditEvent"
  USING ("cooperativeId"::text = current_setting('app.current_cooperative_id', true))
  WITH CHECK ("cooperativeId"::text = current_setting('app.current_cooperative_id', true));
CREATE POLICY correction_request_tenant_policy ON "CorrectionRequest"
  USING (EXISTS (
    SELECT 1 FROM "MilkCollection" collection
    WHERE collection."id" = "CorrectionRequest"."collectionId"
      AND collection."cooperativeId"::text = current_setting('app.current_cooperative_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "MilkCollection" collection
    WHERE collection."id" = "CorrectionRequest"."collectionId"
      AND collection."cooperativeId"::text = current_setting('app.current_cooperative_id', true)
  ));
CREATE POLICY reversal_request_tenant_policy ON "ReversalRequest"
  USING (EXISTS (
    SELECT 1 FROM "MilkCollection" collection
    WHERE collection."id" = "ReversalRequest"."collectionId"
      AND collection."cooperativeId"::text = current_setting('app.current_cooperative_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "MilkCollection" collection
    WHERE collection."id" = "ReversalRequest"."collectionId"
      AND collection."cooperativeId"::text = current_setting('app.current_cooperative_id', true)
  ));
CREATE POLICY notification_attempt_tenant_policy ON "NotificationAttempt"
  USING (EXISTS (
    SELECT 1 FROM "Notification" notification
    WHERE notification."id" = "NotificationAttempt"."notificationId"
      AND notification."cooperativeId"::text = current_setting('app.current_cooperative_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Notification" notification
    WHERE notification."id" = "NotificationAttempt"."notificationId"
      AND notification."cooperativeId"::text = current_setting('app.current_cooperative_id', true)
  ));
