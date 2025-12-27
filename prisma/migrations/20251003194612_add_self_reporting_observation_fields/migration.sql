-- CreateEnum
CREATE TYPE "public"."PrescriptionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."ObservationSource" AS ENUM ('SELF_REPORTED', 'DEVICE', 'DOCTOR_RECORDED', 'IMPORTED');

-- CreateEnum
CREATE TYPE "public"."VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'FLAGGED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."FileUploadStatus" AS ENUM ('UPLOADING', 'COMPLETED', 'FAILED', 'EXPIRED', 'DELETED');

-- CreateEnum
CREATE TYPE "public"."ProfileVisibility" AS ENUM ('PUBLIC', 'FRIENDS', 'PRIVATE');

-- CreateEnum
CREATE TYPE "public"."AccessLevel" AS ENUM ('BASIC', 'MEDICAL', 'FULL');

-- CreateEnum
CREATE TYPE "public"."ThemePreference" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "public"."DataRetentionPeriod" AS ENUM ('ONE_YEAR', 'TWO_YEARS', 'FIVE_YEARS', 'TEN_YEARS', 'INDEFINITE');

-- CreateEnum
CREATE TYPE "public"."NotificationFrequency" AS ENUM ('IMMEDIATE', 'HOURLY', 'DAILY', 'WEEKLY', 'NEVER');

-- AlterEnum
ALTER TYPE "public"."ConsentStatus" ADD VALUE 'INACTIVE';

-- AlterTable
ALTER TABLE "public"."observations" ADD COLUMN     "attachmentUrl" TEXT,
ADD COLUMN     "deviceMetadata" JSONB,
ADD COLUMN     "source" "public"."ObservationSource" NOT NULL DEFAULT 'DOCTOR_RECORDED',
ADD COLUMN     "verificationNotes" TEXT,
ADD COLUMN     "verificationStatus" "public"."VerificationStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedByDoctorId" TEXT;

-- CreateTable
CREATE TABLE "public"."file_uploads" (
    "id" TEXT NOT NULL,
    "ownerHealthId" TEXT NOT NULL,
    "recordId" TEXT,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "checksum" TEXT,
    "storageKey" TEXT NOT NULL,
    "uploadToken" TEXT,
    "status" "public"."FileUploadStatus" NOT NULL DEFAULT 'UPLOADING',
    "description" TEXT,
    "tags" JSONB,
    "uploadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "file_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."file_access" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "accessorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "file_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailNotifications" BOOLEAN NOT NULL DEFAULT true,
    "smsNotifications" BOOLEAN NOT NULL DEFAULT true,
    "profileVisibility" "public"."ProfileVisibility" NOT NULL DEFAULT 'PRIVATE',
    "shareLocation" BOOLEAN NOT NULL DEFAULT false,
    "shareWithEmergency" BOOLEAN NOT NULL DEFAULT true,
    "dataRetentionPeriod" INTEGER NOT NULL DEFAULT 365,
    "autoShareLabs" BOOLEAN NOT NULL DEFAULT false,
    "autoShareRadiology" BOOLEAN NOT NULL DEFAULT false,
    "emergencyAccessLevel" "public"."AccessLevel" NOT NULL DEFAULT 'BASIC',
    "consentReminderDays" INTEGER NOT NULL DEFAULT 30,
    "sessionTimeoutMinutes" INTEGER NOT NULL DEFAULT 60,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."emergency_contacts" (
    "id" TEXT NOT NULL,
    "userSettingsId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "accessLevel" "public"."AccessLevel" NOT NULL DEFAULT 'BASIC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "emergency_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "details" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notification_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailNotifications" BOOLEAN NOT NULL DEFAULT true,
    "smsNotifications" BOOLEAN NOT NULL DEFAULT false,
    "pushNotifications" BOOLEAN NOT NULL DEFAULT true,
    "appointmentReminders" BOOLEAN NOT NULL DEFAULT true,
    "recordUpdates" BOOLEAN NOT NULL DEFAULT true,
    "marketingEmails" BOOLEAN NOT NULL DEFAULT false,
    "securityAlerts" BOOLEAN NOT NULL DEFAULT true,
    "billingNotifications" BOOLEAN NOT NULL DEFAULT true,
    "labResults" BOOLEAN NOT NULL DEFAULT true,
    "prescriptionUpdates" BOOLEAN NOT NULL DEFAULT true,
    "frequency" "public"."NotificationFrequency" NOT NULL DEFAULT 'IMMEDIATE',
    "quietHoursStart" TEXT,
    "quietHoursEnd" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."appearance_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "theme" "public"."ThemePreference" NOT NULL DEFAULT 'SYSTEM',
    "language" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "dateFormat" TEXT NOT NULL DEFAULT 'MM/DD/YYYY',
    "timeFormat" TEXT NOT NULL DEFAULT '12h',
    "fontSize" TEXT NOT NULL DEFAULT 'medium',
    "fontFamily" TEXT NOT NULL DEFAULT 'system',
    "highContrast" BOOLEAN NOT NULL DEFAULT false,
    "reduceMotion" BOOLEAN NOT NULL DEFAULT false,
    "compactMode" BOOLEAN NOT NULL DEFAULT false,
    "showAnimations" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appearance_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."security_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorSecret" TEXT,
    "backupCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sessionTimeout" INTEGER NOT NULL DEFAULT 3600,
    "loginNotifications" BOOLEAN NOT NULL DEFAULT true,
    "deviceTracking" BOOLEAN NOT NULL DEFAULT true,
    "passwordChangedAt" TIMESTAMP(3),
    "lastPasswordCheck" TIMESTAMP(3),
    "requirePasswordChange" BOOLEAN NOT NULL DEFAULT false,
    "allowedIpAddresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blockedIpAddresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxConcurrentSessions" INTEGER NOT NULL DEFAULT 5,
    "autoLockTimeout" INTEGER NOT NULL DEFAULT 900,
    "requireBiometric" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "security_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."data_management_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dataRetentionPeriod" "public"."DataRetentionPeriod" NOT NULL DEFAULT 'FIVE_YEARS',
    "autoBackup" BOOLEAN NOT NULL DEFAULT true,
    "backupFrequency" TEXT NOT NULL DEFAULT 'weekly',
    "exportFormat" TEXT NOT NULL DEFAULT 'JSON',
    "includeDeletedData" BOOLEAN NOT NULL DEFAULT false,
    "shareAggregatedData" BOOLEAN NOT NULL DEFAULT false,
    "allowDataMining" BOOLEAN NOT NULL DEFAULT false,
    "gdprCompliant" BOOLEAN NOT NULL DEFAULT true,
    "hipaaCompliant" BOOLEAN NOT NULL DEFAULT true,
    "encryptBackups" BOOLEAN NOT NULL DEFAULT true,
    "cloudBackupEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastExportDate" TIMESTAMP(3),
    "lastBackupDate" TIMESTAMP(3),
    "totalDataSize" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_management_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "deviceInfo" TEXT,
    "deviceId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "location" TEXT,
    "browser" TEXT,
    "os" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isTrusted" BOOLEAN NOT NULL DEFAULT false,
    "lastActivity" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "file_uploads_ownerHealthId_idx" ON "public"."file_uploads"("ownerHealthId");

-- CreateIndex
CREATE INDEX "file_uploads_recordId_idx" ON "public"."file_uploads"("recordId");

-- CreateIndex
CREATE INDEX "file_uploads_status_idx" ON "public"."file_uploads"("status");

-- CreateIndex
CREATE INDEX "file_uploads_mimeType_idx" ON "public"."file_uploads"("mimeType");

-- CreateIndex
CREATE INDEX "file_uploads_createdAt_idx" ON "public"."file_uploads"("createdAt");

-- CreateIndex
CREATE INDEX "file_access_fileId_idx" ON "public"."file_access"("fileId");

-- CreateIndex
CREATE INDEX "file_access_accessorId_idx" ON "public"."file_access"("accessorId");

-- CreateIndex
CREATE INDEX "file_access_accessedAt_idx" ON "public"."file_access"("accessedAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_userId_key" ON "public"."user_settings"("userId");

-- CreateIndex
CREATE INDEX "emergency_contacts_userSettingsId_idx" ON "public"."emergency_contacts"("userSettingsId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "public"."audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "public"."audit_logs"("timestamp");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "public"."audit_logs"("action");

-- CreateIndex
CREATE UNIQUE INDEX "notification_settings_userId_key" ON "public"."notification_settings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "appearance_settings_userId_key" ON "public"."appearance_settings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "security_settings_userId_key" ON "public"."security_settings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "data_management_settings_userId_key" ON "public"."data_management_settings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_sessionToken_key" ON "public"."user_sessions"("sessionToken");

-- CreateIndex
CREATE INDEX "user_sessions_userId_idx" ON "public"."user_sessions"("userId");

-- CreateIndex
CREATE INDEX "user_sessions_sessionToken_idx" ON "public"."user_sessions"("sessionToken");

-- CreateIndex
CREATE INDEX "user_sessions_isActive_idx" ON "public"."user_sessions"("isActive");

-- CreateIndex
CREATE INDEX "user_sessions_expiresAt_idx" ON "public"."user_sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "user_sessions_lastActivity_idx" ON "public"."user_sessions"("lastActivity");

-- CreateIndex
CREATE INDEX "observations_source_idx" ON "public"."observations"("source");

-- CreateIndex
CREATE INDEX "observations_verificationStatus_idx" ON "public"."observations"("verificationStatus");

-- CreateIndex
CREATE INDEX "observations_verifiedByDoctorId_idx" ON "public"."observations"("verifiedByDoctorId");

-- AddForeignKey
ALTER TABLE "public"."observations" ADD CONSTRAINT "observations_verifiedByDoctorId_fkey" FOREIGN KEY ("verifiedByDoctorId") REFERENCES "public"."users"("healthId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."file_uploads" ADD CONSTRAINT "file_uploads_ownerHealthId_fkey" FOREIGN KEY ("ownerHealthId") REFERENCES "public"."users"("healthId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."file_access" ADD CONSTRAINT "file_access_accessorId_fkey" FOREIGN KEY ("accessorId") REFERENCES "public"."users"("healthId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."file_access" ADD CONSTRAINT "file_access_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "public"."file_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_settings" ADD CONSTRAINT "user_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("healthId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."emergency_contacts" ADD CONSTRAINT "emergency_contacts_userSettingsId_fkey" FOREIGN KEY ("userSettingsId") REFERENCES "public"."user_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("healthId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notification_settings" ADD CONSTRAINT "notification_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("healthId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."appearance_settings" ADD CONSTRAINT "appearance_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("healthId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."security_settings" ADD CONSTRAINT "security_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("healthId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."data_management_settings" ADD CONSTRAINT "data_management_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("healthId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_sessions" ADD CONSTRAINT "user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("healthId") ON DELETE CASCADE ON UPDATE CASCADE;
