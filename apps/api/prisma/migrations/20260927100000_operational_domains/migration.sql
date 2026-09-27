CREATE TYPE "ScaleConnectionState" AS ENUM ('UNKNOWN', 'CONNECTED', 'DISCONNECTED');
CREATE TYPE "SmsLedgerType" AS ENUM ('PURCHASE', 'RESERVED', 'CONSUMED', 'RELEASED', 'REFUNDED');
CREATE TYPE "PaymentVerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "ScaleDevice"
  ADD COLUMN "serialNumber" TEXT,
  ADD COLUMN "coolerId" TEXT,
  ADD COLUMN "connectionState" "ScaleConnectionState" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "batteryLevel" INTEGER;
ALTER TABLE "CorrectionRequest" ADD COLUMN "originalQuantityKg" DECIMAL(12,3);
ALTER TABLE "ReversalRequest"
  ADD COLUMN "originalQuantityKg" DECIMAL(12,3),
  ADD COLUMN "requestedQuantityKg" DECIMAL(12,3);

CREATE TABLE "Cooler" (
  "id" TEXT NOT NULL,
  "cooperativeId" TEXT NOT NULL,
  "centreId" TEXT,
  "name" TEXT NOT NULL,
  "serialNumber" TEXT NOT NULL,
  "locationLabel" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Cooler_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MilkPricing" (
  "id" TEXT NOT NULL,
  "cooperativeId" TEXT NOT NULL,
  "coolerId" TEXT,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "pricePerKg" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'KES',
  "createdBy" TEXT NOT NULL,
  "approvedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MilkPricing_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SmsPackage" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "smsCount" INTEGER NOT NULL,
  "price" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'KES',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SmsPackage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentVerification" (
  "id" TEXT NOT NULL,
  "cooperativeId" TEXT NOT NULL,
  "packageId" TEXT NOT NULL,
  "mpesaReference" TEXT NOT NULL,
  "amountPaid" DECIMAL(12,2) NOT NULL,
  "payerPhone" TEXT NOT NULL,
  "submittedBy" TEXT NOT NULL,
  "status" "PaymentVerificationStatus" NOT NULL DEFAULT 'PENDING',
  "verifiedBy" TEXT,
  "rejectionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  CONSTRAINT "PaymentVerification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SmsLedgerEntry" (
  "id" TEXT NOT NULL,
  "cooperativeId" TEXT NOT NULL,
  "type" "SmsLedgerType" NOT NULL,
  "credits" INTEGER NOT NULL,
  "amount" DECIMAL(12,2),
  "reference" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "packageId" TEXT,
  "paymentVerificationId" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SmsLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Cooler_serialNumber_key" ON "Cooler"("serialNumber");
CREATE INDEX "Cooler_cooperativeId_active_idx" ON "Cooler"("cooperativeId", "active");
CREATE UNIQUE INDEX "ScaleDevice_serialNumber_key" ON "ScaleDevice"("serialNumber");
CREATE INDEX "MilkPricing_cooperativeId_effectiveFrom_effectiveTo_idx" ON "MilkPricing"("cooperativeId", "effectiveFrom", "effectiveTo");
CREATE UNIQUE INDEX "MilkPricing_cooperativeId_coolerId_effectiveFrom_key" ON "MilkPricing"("cooperativeId", "coolerId", "effectiveFrom");
CREATE INDEX "SmsPackage_active_price_idx" ON "SmsPackage"("active", "price");
CREATE UNIQUE INDEX "PaymentVerification_mpesaReference_key" ON "PaymentVerification"("mpesaReference");
CREATE INDEX "PaymentVerification_status_createdAt_idx" ON "PaymentVerification"("status", "createdAt");
CREATE INDEX "PaymentVerification_cooperativeId_status_createdAt_idx" ON "PaymentVerification"("cooperativeId", "status", "createdAt");
CREATE UNIQUE INDEX "SmsLedgerEntry_cooperativeId_idempotencyKey_key" ON "SmsLedgerEntry"("cooperativeId", "idempotencyKey");
CREATE INDEX "SmsLedgerEntry_cooperativeId_createdAt_idx" ON "SmsLedgerEntry"("cooperativeId", "createdAt");
CREATE INDEX "SmsLedgerEntry_cooperativeId_type_createdAt_idx" ON "SmsLedgerEntry"("cooperativeId", "type", "createdAt");

ALTER TABLE "Cooler" ADD CONSTRAINT "Cooler_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "Cooperative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Cooler" ADD CONSTRAINT "Cooler_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "CollectionCentre"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ScaleDevice" ADD CONSTRAINT "ScaleDevice_coolerId_fkey" FOREIGN KEY ("coolerId") REFERENCES "Cooler"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MilkPricing" ADD CONSTRAINT "MilkPricing_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "Cooperative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MilkPricing" ADD CONSTRAINT "MilkPricing_coolerId_fkey" FOREIGN KEY ("coolerId") REFERENCES "Cooler"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentVerification" ADD CONSTRAINT "PaymentVerification_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "Cooperative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentVerification" ADD CONSTRAINT "PaymentVerification_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "SmsPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SmsLedgerEntry" ADD CONSTRAINT "SmsLedgerEntry_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "Cooperative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SmsLedgerEntry" ADD CONSTRAINT "SmsLedgerEntry_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "SmsPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SmsLedgerEntry" ADD CONSTRAINT "SmsLedgerEntry_paymentVerificationId_fkey" FOREIGN KEY ("paymentVerificationId") REFERENCES "PaymentVerification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Cooler" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Cooler" FORCE ROW LEVEL SECURITY;
ALTER TABLE "MilkPricing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MilkPricing" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PaymentVerification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentVerification" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SmsLedgerEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SmsLedgerEntry" FORCE ROW LEVEL SECURITY;

CREATE POLICY cooler_tenant_policy ON "Cooler"
  USING ("cooperativeId"::text = current_setting('app.current_cooperative_id', true))
  WITH CHECK ("cooperativeId"::text = current_setting('app.current_cooperative_id', true));
CREATE POLICY milk_pricing_tenant_policy ON "MilkPricing"
  USING ("cooperativeId"::text = current_setting('app.current_cooperative_id', true))
  WITH CHECK ("cooperativeId"::text = current_setting('app.current_cooperative_id', true));
CREATE POLICY payment_verification_tenant_policy ON "PaymentVerification"
  USING ("cooperativeId"::text = current_setting('app.current_cooperative_id', true))
  WITH CHECK ("cooperativeId"::text = current_setting('app.current_cooperative_id', true));
CREATE POLICY sms_ledger_tenant_policy ON "SmsLedgerEntry"
  USING ("cooperativeId"::text = current_setting('app.current_cooperative_id', true))
  WITH CHECK ("cooperativeId"::text = current_setting('app.current_cooperative_id', true));

ALTER TABLE "SmsLedgerEntry" ADD CONSTRAINT "SmsLedgerEntry_credit_sign_check" CHECK (
  ("type" IN ('PURCHASE', 'RELEASED', 'REFUNDED') AND "credits" > 0)
  OR ("type" IN ('RESERVED', 'CONSUMED') AND "credits" < 0)
);

CREATE FUNCTION prevent_sms_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'SMS ledger entries are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SmsLedgerEntry_immutable_update"
  BEFORE UPDATE OR DELETE ON "SmsLedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION prevent_sms_ledger_mutation();