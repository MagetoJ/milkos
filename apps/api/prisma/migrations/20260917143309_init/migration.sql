-- CreateEnum
CREATE TYPE "CooperativeStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'MORE_INFORMATION_REQUIRED', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('COOPERATIVE_MANAGER', 'COLLECTOR', 'FARMER');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "VerificationChannel" AS ENUM ('PHONE', 'GOOGLE', 'EMAIL');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'EXPIRED', 'LOCKED');

-- CreateEnum
CREATE TYPE "CollectionStatus" AS ENUM ('CONFIRMED', 'SYNC_PENDING', 'SYNCED', 'CORRECTION_REQUESTED', 'CORRECTED', 'REVERSAL_REQUESTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SENT', 'FAILED', 'MANUAL_RETRY');

-- CreateEnum
CREATE TYPE "MeasurementUnit" AS ENUM ('KG', 'LITRES', 'BOTH');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "keycloakId" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cooperative" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "registrationNumber" TEXT,
    "status" "CooperativeStatus" NOT NULL DEFAULT 'PENDING',
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "measurementUnit" "MeasurementUnit" NOT NULL DEFAULT 'KG',
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "secondaryColor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cooperative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cooperativeId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationVerification" (
    "id" TEXT NOT NULL,
    "channel" "VerificationChannel" NOT NULL,
    "destination" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "codeHash" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistrationVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CooperativeApplication" (
    "id" TEXT NOT NULL,
    "cooperativeId" TEXT NOT NULL,
    "applicantUserId" TEXT NOT NULL,
    "status" "CooperativeStatus" NOT NULL DEFAULT 'PENDING',
    "reference" TEXT NOT NULL,
    "notes" TEXT,
    "requestedInformation" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,

    CONSTRAINT "CooperativeApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Farmer" (
    "id" TEXT NOT NULL,
    "cooperativeId" TEXT NOT NULL,
    "memberNumber" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "smartRunFarmUserId" TEXT,
    "centreId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Farmer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionCentre" (
    "id" TEXT NOT NULL,
    "cooperativeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CollectionCentre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScaleDevice" (
    "id" TEXT NOT NULL,
    "deviceIdentifier" TEXT NOT NULL,
    "cooperativeId" TEXT NOT NULL,
    "centreId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "ScaleDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MilkCollection" (
    "id" TEXT NOT NULL,
    "cooperativeId" TEXT NOT NULL,
    "farmerId" TEXT NOT NULL,
    "collectorUserId" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "quantityKg" DECIMAL(12,3) NOT NULL,
    "quantityLitres" DECIMAL(12,3),
    "unit" "MeasurementUnit" NOT NULL DEFAULT 'KG',
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "offlineCreatedAt" TIMESTAMP(3),
    "scaleDeviceId" TEXT,
    "status" "CollectionStatus" NOT NULL DEFAULT 'CONFIRMED',
    "syncStatus" TEXT NOT NULL DEFAULT 'SYNCED',
    "idempotencyKey" TEXT NOT NULL,
    "referenceNumber" TEXT NOT NULL,
    "pricePerKg" DECIMAL(12,2),
    "amount" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MilkCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectionRequest" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "requestedQuantityKg" DECIMAL(12,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "CorrectionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReversalRequest" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "reason" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "ReversalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceTable" (
    "id" TEXT NOT NULL,
    "cooperativeId" TEXT NOT NULL,
    "effectiveMonth" TIMESTAMP(3) NOT NULL,
    "pricePerKg" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "cooperativeId" TEXT NOT NULL,
    "collectionId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'SMS',
    "recipient" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationAttempt" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "providerResponse" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "cooperativeId" TEXT,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "result" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "correlationId" TEXT,
    "beforeState" JSONB,
    "afterState" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "cooperativeId" TEXT,
    "event" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "reason" TEXT,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT,
    "requestId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_keycloakId_key" ON "User"("keycloakId");

-- CreateIndex
CREATE INDEX "Membership_cooperativeId_status_idx" ON "Membership"("cooperativeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_cooperativeId_role_key" ON "Membership"("userId", "cooperativeId", "role");

-- CreateIndex
CREATE INDEX "RegistrationVerification_destination_channel_status_idx" ON "RegistrationVerification"("destination", "channel", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CooperativeApplication_cooperativeId_key" ON "CooperativeApplication"("cooperativeId");

-- CreateIndex
CREATE UNIQUE INDEX "CooperativeApplication_reference_key" ON "CooperativeApplication"("reference");

-- CreateIndex
CREATE INDEX "Farmer_cooperativeId_fullName_idx" ON "Farmer"("cooperativeId", "fullName");

-- CreateIndex
CREATE UNIQUE INDEX "Farmer_cooperativeId_memberNumber_key" ON "Farmer"("cooperativeId", "memberNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionCentre_cooperativeId_name_key" ON "CollectionCentre"("cooperativeId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ScaleDevice_deviceIdentifier_key" ON "ScaleDevice"("deviceIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "MilkCollection_referenceNumber_key" ON "MilkCollection"("referenceNumber");

-- CreateIndex
CREATE INDEX "MilkCollection_cooperativeId_collectedAt_idx" ON "MilkCollection"("cooperativeId", "collectedAt");

-- CreateIndex
CREATE INDEX "MilkCollection_cooperativeId_farmerId_collectedAt_idx" ON "MilkCollection"("cooperativeId", "farmerId", "collectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MilkCollection_cooperativeId_idempotencyKey_key" ON "MilkCollection"("cooperativeId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ReversalRequest_collectionId_status_idx" ON "ReversalRequest"("collectionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PriceTable_cooperativeId_effectiveMonth_key" ON "PriceTable"("cooperativeId", "effectiveMonth");

-- CreateIndex
CREATE INDEX "Notification_cooperativeId_status_idx" ON "Notification"("cooperativeId", "status");

-- CreateIndex
CREATE INDEX "AuditEvent_cooperativeId_createdAt_idx" ON "AuditEvent"("cooperativeId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_createdAt_idx" ON "AuditEvent"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_ipAddress_createdAt_idx" ON "SecurityEvent"("ipAddress", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_event_createdAt_idx" ON "SecurityEvent"("event", "createdAt");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "Cooperative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CooperativeApplication" ADD CONSTRAINT "CooperativeApplication_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "Cooperative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Farmer" ADD CONSTRAINT "Farmer_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "Cooperative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Farmer" ADD CONSTRAINT "Farmer_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "CollectionCentre"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionCentre" ADD CONSTRAINT "CollectionCentre_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "Cooperative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilkCollection" ADD CONSTRAINT "MilkCollection_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "Cooperative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilkCollection" ADD CONSTRAINT "MilkCollection_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "Farmer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilkCollection" ADD CONSTRAINT "MilkCollection_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "CollectionCentre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "MilkCollection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReversalRequest" ADD CONSTRAINT "ReversalRequest_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "MilkCollection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceTable" ADD CONSTRAINT "PriceTable_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "Cooperative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "Cooperative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "MilkCollection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationAttempt" ADD CONSTRAINT "NotificationAttempt_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "Cooperative"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
