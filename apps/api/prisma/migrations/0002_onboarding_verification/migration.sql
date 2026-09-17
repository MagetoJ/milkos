CREATE TYPE "VerificationChannel" AS ENUM ('PHONE','GOOGLE','EMAIL');
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING','VERIFIED','EXPIRED','LOCKED');

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
CREATE INDEX "RegistrationVerification_destination_channel_status_idx" ON "RegistrationVerification"("destination","channel","status");
ALTER TABLE "CooperativeApplication" ADD COLUMN "requestedInformation" TEXT;
