/*
  Warnings:

  - The values [ALL_RECORDS,LAST_3_MONTHS,LAST_6_MONTHS,LAST_YEAR,SPECIFIC_TYPES] on the enum `ConsentScope` will be removed. If these variants are still used in the database, this will fail.
  - The values [PENDING] on the enum `ConsentStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `respondedAt` on the `consent_requests` table. All the data in the column will be lost.
  - You are about to drop the column `specificTypes` on the `consent_requests` table. All the data in the column will be lost.
  - The `status` column on the `consent_requests` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `createdBy` on the `consents` table. All the data in the column will be lost.
  - You are about to drop the column `specificTypes` on the `consents` table. All the data in the column will be lost.
  - The `permissions` column on the `consents` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `actorId` on the `health_id_audits` table. All the data in the column will be lost.
  - You are about to drop the column `actorRole` on the `health_id_audits` table. All the data in the column will be lost.
  - You are about to drop the column `consentId` on the `health_id_audits` table. All the data in the column will be lost.
  - You are about to drop the column `hashedChain` on the `health_id_audits` table. All the data in the column will be lost.
  - You are about to drop the column `reason` on the `health_id_audits` table. All the data in the column will be lost.
  - You are about to drop the column `resourceId` on the `health_id_audits` table. All the data in the column will be lost.
  - You are about to drop the column `resourceType` on the `health_id_audits` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `consent_requests` table without a default value. This is not possible if the table is not empty.
  - Changed the column `scope` on the `consent_requests` table from a scalar field to a list field. If there are non-null values in that column, this step will fail.
  - Added the required column `updatedAt` to the `consents` table without a default value. This is not possible if the table is not empty.
  - Changed the column `scope` on the `consents` table from a scalar field to a list field. If there are non-null values in that column, this step will fail.
  - Added the required column `accessedBy` to the `health_id_audits` table without a default value. This is not possible if the table is not empty.
  - Made the column `healthId` on table `health_id_audits` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "public"."RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'EXPIRED');

-- AlterEnum
BEGIN;
CREATE TYPE "public"."ConsentScope_new" AS ENUM ('READ_BASIC', 'READ_MEDICAL', 'READ_LAB', 'READ_RADIOLOGY', 'WRITE_PRESCRIPTION', 'WRITE_NOTES', 'EMERGENCY_ACCESS');
ALTER TABLE "public"."consent_requests" ALTER COLUMN "scope" DROP DEFAULT;
ALTER TABLE "public"."consents" ALTER COLUMN "scope" DROP DEFAULT;
ALTER TABLE "public"."consents" ALTER COLUMN "scope" TYPE "public"."ConsentScope_new"[] USING ("scope"::text::"public"."ConsentScope_new"[]);
ALTER TABLE "public"."consent_requests" ALTER COLUMN "scope" TYPE "public"."ConsentScope_new"[] USING ("scope"::text::"public"."ConsentScope_new"[]);
ALTER TYPE "public"."ConsentScope" RENAME TO "ConsentScope_old";
ALTER TYPE "public"."ConsentScope_new" RENAME TO "ConsentScope";
DROP TYPE "public"."ConsentScope_old";
ALTER TABLE "public"."consent_requests" ALTER COLUMN "scope" SET DEFAULT ARRAY[]::"public"."ConsentScope"[];
ALTER TABLE "public"."consents" ALTER COLUMN "scope" SET DEFAULT ARRAY[]::"public"."ConsentScope"[];
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "public"."ConsentStatus_new" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED', 'REQUESTED', 'DENIED');
ALTER TABLE "public"."consents" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."consents" ALTER COLUMN "status" TYPE "public"."ConsentStatus_new" USING ("status"::text::"public"."ConsentStatus_new");
ALTER TYPE "public"."ConsentStatus" RENAME TO "ConsentStatus_old";
ALTER TYPE "public"."ConsentStatus_new" RENAME TO "ConsentStatus";
DROP TYPE "public"."ConsentStatus_old";
ALTER TABLE "public"."consents" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
COMMIT;

-- DropForeignKey
ALTER TABLE "public"."consent_requests" DROP CONSTRAINT "consent_requests_patientId_fkey";

-- DropForeignKey
ALTER TABLE "public"."consent_requests" DROP CONSTRAINT "consent_requests_providerId_fkey";

-- DropForeignKey
ALTER TABLE "public"."consents" DROP CONSTRAINT "consents_patientId_fkey";

-- DropForeignKey
ALTER TABLE "public"."consents" DROP CONSTRAINT "consents_providerId_fkey";

-- DropIndex
DROP INDEX "public"."consent_requests_expiresAt_idx";

-- DropIndex
DROP INDEX "public"."consents_endTime_idx";

-- DropIndex
DROP INDEX "public"."health_id_audits_action_idx";

-- DropIndex
DROP INDEX "public"."health_id_audits_actorId_idx";

-- DropIndex
DROP INDEX "public"."health_id_audits_resourceType_resourceId_idx";

-- AlterTable
ALTER TABLE "public"."consent_requests" DROP COLUMN "respondedAt",
DROP COLUMN "specificTypes",
ADD COLUMN     "deniedReason" TEXT,
ADD COLUMN     "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "scope" SET DEFAULT ARRAY[]::"public"."ConsentScope"[],
ALTER COLUMN "scope" SET DATA TYPE "public"."ConsentScope"[],
DROP COLUMN "status",
ADD COLUMN     "status" "public"."RequestStatus" NOT NULL DEFAULT 'PENDING',
ALTER COLUMN "expiresAt" DROP NOT NULL;

-- AlterTable
ALTER TABLE "public"."consents" DROP COLUMN "createdBy",
DROP COLUMN "specificTypes",
ADD COLUMN     "accessCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "lastAccessed" TIMESTAMP(3),
ADD COLUMN     "revokedReason" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
DROP COLUMN "permissions",
ADD COLUMN     "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "scope" SET DEFAULT ARRAY[]::"public"."ConsentScope"[],
ALTER COLUMN "scope" SET DATA TYPE "public"."ConsentScope"[];

-- AlterTable
ALTER TABLE "public"."health_id_audits" DROP COLUMN "actorId",
DROP COLUMN "actorRole",
DROP COLUMN "consentId",
DROP COLUMN "hashedChain",
DROP COLUMN "reason",
DROP COLUMN "resourceId",
DROP COLUMN "resourceType",
ADD COLUMN     "accessedBy" TEXT NOT NULL,
ALTER COLUMN "healthId" SET NOT NULL;

-- CreateTable
CREATE TABLE "public"."emergency_shares" (
    "id" TEXT NOT NULL,
    "patientHealthId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "usedAt" TIMESTAMP(3),
    "accessedBy" TEXT,
    "accessLog" JSONB,

    CONSTRAINT "emergency_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "emergency_shares_tokenHash_key" ON "public"."emergency_shares"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_shares_shareId_key" ON "public"."emergency_shares"("shareId");

-- CreateIndex
CREATE INDEX "emergency_shares_tokenHash_idx" ON "public"."emergency_shares"("tokenHash");

-- CreateIndex
CREATE INDEX "emergency_shares_shareId_idx" ON "public"."emergency_shares"("shareId");

-- CreateIndex
CREATE INDEX "emergency_shares_patientHealthId_idx" ON "public"."emergency_shares"("patientHealthId");

-- CreateIndex
CREATE INDEX "emergency_shares_expiresAt_idx" ON "public"."emergency_shares"("expiresAt");

-- CreateIndex
CREATE INDEX "consent_requests_status_idx" ON "public"."consent_requests"("status");

-- CreateIndex
CREATE INDEX "consents_patientId_idx" ON "public"."consents"("patientId");

-- CreateIndex
CREATE INDEX "consents_providerId_idx" ON "public"."consents"("providerId");

-- CreateIndex
CREATE INDEX "health_id_audits_accessedBy_idx" ON "public"."health_id_audits"("accessedBy");

-- AddForeignKey
ALTER TABLE "public"."consents" ADD CONSTRAINT "consents_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "public"."users"("healthId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."consents" ADD CONSTRAINT "consents_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "public"."users"("healthId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."consents" ADD CONSTRAINT "consents_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."consent_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."consent_requests" ADD CONSTRAINT "consent_requests_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "public"."users"("healthId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."consent_requests" ADD CONSTRAINT "consent_requests_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "public"."users"("healthId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."emergency_shares" ADD CONSTRAINT "emergency_shares_patientHealthId_fkey" FOREIGN KEY ("patientHealthId") REFERENCES "public"."users"("healthId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."emergency_shares" ADD CONSTRAINT "emergency_shares_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("healthId") ON DELETE RESTRICT ON UPDATE CASCADE;
