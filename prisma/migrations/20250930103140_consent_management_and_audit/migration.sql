/*
  Warnings:

  - You are about to drop the column `expiresAt` on the `consents` table. All the data in the column will be lost.
  - You are about to drop the column `accessedBy` on the `health_id_audits` table. All the data in the column will be lost.
  - Added the required column `createdBy` to the `consents` table without a default value. This is not possible if the table is not empty.
  - Added the required column `purpose` to the `consents` table without a default value. This is not possible if the table is not empty.
  - Added the required column `actorId` to the `health_id_audits` table without a default value. This is not possible if the table is not empty.
  - Added the required column `actorRole` to the `health_id_audits` table without a default value. This is not possible if the table is not empty.
  - Added the required column `resourceId` to the `health_id_audits` table without a default value. This is not possible if the table is not empty.
  - Added the required column `resourceType` to the `health_id_audits` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."ConsentScope" AS ENUM ('ALL_RECORDS', 'LAST_3_MONTHS', 'LAST_6_MONTHS', 'LAST_YEAR', 'SPECIFIC_TYPES');

-- AlterEnum
ALTER TYPE "public"."ConsentStatus" ADD VALUE 'PENDING';

-- DropIndex
DROP INDEX "public"."health_id_audits_accessedBy_idx";

-- AlterTable
ALTER TABLE "public"."consents" DROP COLUMN "expiresAt",
ADD COLUMN     "createdBy" TEXT NOT NULL,
ADD COLUMN     "endTime" TIMESTAMP(3),
ADD COLUMN     "permissions" JSONB,
ADD COLUMN     "purpose" TEXT NOT NULL,
ADD COLUMN     "requestId" TEXT,
ADD COLUMN     "scope" "public"."ConsentScope" NOT NULL DEFAULT 'ALL_RECORDS',
ADD COLUMN     "specificTypes" JSONB,
ADD COLUMN     "startTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "public"."health_id_audits" DROP COLUMN "accessedBy",
ADD COLUMN     "actorId" TEXT NOT NULL,
ADD COLUMN     "actorRole" TEXT NOT NULL,
ADD COLUMN     "consentId" TEXT,
ADD COLUMN     "hashedChain" TEXT,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "resourceId" TEXT NOT NULL,
ADD COLUMN     "resourceType" TEXT NOT NULL,
ALTER COLUMN "healthId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "public"."consent_requests" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "scope" "public"."ConsentScope" NOT NULL DEFAULT 'ALL_RECORDS',
    "specificTypes" JSONB,
    "purpose" TEXT NOT NULL,
    "requestedExpiry" TIMESTAMP(3),
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "consent_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consent_requests_patientId_idx" ON "public"."consent_requests"("patientId");

-- CreateIndex
CREATE INDEX "consent_requests_providerId_idx" ON "public"."consent_requests"("providerId");

-- CreateIndex
CREATE INDEX "consent_requests_status_idx" ON "public"."consent_requests"("status");

-- CreateIndex
CREATE INDEX "consent_requests_expiresAt_idx" ON "public"."consent_requests"("expiresAt");

-- CreateIndex
CREATE INDEX "consents_endTime_idx" ON "public"."consents"("endTime");

-- CreateIndex
CREATE INDEX "health_id_audits_actorId_idx" ON "public"."health_id_audits"("actorId");

-- CreateIndex
CREATE INDEX "health_id_audits_resourceType_resourceId_idx" ON "public"."health_id_audits"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "health_id_audits_action_idx" ON "public"."health_id_audits"("action");

-- AddForeignKey
ALTER TABLE "public"."consent_requests" ADD CONSTRAINT "consent_requests_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "public"."users"("healthId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."consent_requests" ADD CONSTRAINT "consent_requests_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "public"."users"("healthId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."consents" ADD CONSTRAINT "consents_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "public"."users"("healthId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."consents" ADD CONSTRAINT "consents_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "public"."users"("healthId") ON DELETE CASCADE ON UPDATE CASCADE;
