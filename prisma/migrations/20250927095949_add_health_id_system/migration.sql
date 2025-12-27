/*
  Warnings:

  - The values [active,revoked,expired] on the enum `ConsentStatus` will be removed. If these variants are still used in the database, this will fail.
  - A unique constraint covering the columns `[healthId]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "public"."ConsentStatus_new" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');
ALTER TABLE "public"."consents" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."consents" ALTER COLUMN "status" TYPE "public"."ConsentStatus_new" USING ("status"::text::"public"."ConsentStatus_new");
ALTER TYPE "public"."ConsentStatus" RENAME TO "ConsentStatus_old";
ALTER TYPE "public"."ConsentStatus_new" RENAME TO "ConsentStatus";
DROP TYPE "public"."ConsentStatus_old";
ALTER TABLE "public"."consents" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
COMMIT;

-- AlterTable
ALTER TABLE "public"."consents" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "public"."users" ADD COLUMN     "healthId" TEXT,
ADD COLUMN     "isVerified" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "public"."health_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "gender" TEXT,
    "bloodGroup" TEXT,
    "allergies" JSONB,
    "medications" JSONB,
    "emergencyContact" TEXT,
    "emergencyPhone" TEXT,
    "address" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."health_id_audits" (
    "id" TEXT NOT NULL,
    "healthId" TEXT NOT NULL,
    "accessedBy" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_id_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "health_profiles_userId_key" ON "public"."health_profiles"("userId");

-- CreateIndex
CREATE INDEX "health_id_audits_healthId_idx" ON "public"."health_id_audits"("healthId");

-- CreateIndex
CREATE INDEX "health_id_audits_accessedBy_idx" ON "public"."health_id_audits"("accessedBy");

-- CreateIndex
CREATE INDEX "health_id_audits_timestamp_idx" ON "public"."health_id_audits"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "users_healthId_key" ON "public"."users"("healthId");
