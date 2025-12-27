-- CreateEnum
CREATE TYPE "public"."ConsentStatus" AS ENUM ('active', 'revoked', 'expired');

-- CreateTable
CREATE TABLE "public"."consents" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" "public"."ConsentStatus" NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."encounters" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByRole" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "encounters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."observations" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "encounterId" TEXT,
    "code" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "unit" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "createdByRole" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "observations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consents_patientId_providerId_idx" ON "public"."consents"("patientId", "providerId");

-- CreateIndex
CREATE INDEX "consents_status_idx" ON "public"."consents"("status");

-- CreateIndex
CREATE INDEX "encounters_patientId_idx" ON "public"."encounters"("patientId");

-- CreateIndex
CREATE INDEX "encounters_providerId_idx" ON "public"."encounters"("providerId");

-- CreateIndex
CREATE INDEX "encounters_startTime_idx" ON "public"."encounters"("startTime");

-- CreateIndex
CREATE INDEX "observations_patientId_idx" ON "public"."observations"("patientId");

-- CreateIndex
CREATE INDEX "observations_providerId_idx" ON "public"."observations"("providerId");

-- CreateIndex
CREATE INDEX "observations_encounterId_idx" ON "public"."observations"("encounterId");

-- AddForeignKey
ALTER TABLE "public"."observations" ADD CONSTRAINT "observations_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "public"."encounters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
