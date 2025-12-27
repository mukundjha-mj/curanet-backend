-- CreateEnum
CREATE TYPE "public"."AppointmentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "public"."AppointmentNotificationType" AS ENUM ('APPOINTMENT_REQUESTED', 'APPOINTMENT_CONFIRMED', 'APPOINTMENT_REJECTED', 'APPOINTMENT_CANCELLED', 'APPOINTMENT_REMINDER');

-- CreateTable
CREATE TABLE "public"."appointments" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "facilityId" TEXT,
    "requestedTime" TIMESTAMP(3) NOT NULL,
    "status" "public"."AppointmentStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "patientNotes" TEXT,
    "doctorNotes" TEXT,
    "reasonForVisit" TEXT,
    "duration" INTEGER,
    "appointmentType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."appointment_notifications" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "type" "public"."AppointmentNotificationType" NOT NULL,
    "message" TEXT NOT NULL,
    "sent" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointments_patientId_idx" ON "public"."appointments"("patientId");

-- CreateIndex
CREATE INDEX "appointments_doctorId_idx" ON "public"."appointments"("doctorId");

-- CreateIndex
CREATE INDEX "appointments_status_idx" ON "public"."appointments"("status");

-- CreateIndex
CREATE INDEX "appointments_requestedTime_idx" ON "public"."appointments"("requestedTime");

-- CreateIndex
CREATE INDEX "appointments_createdAt_idx" ON "public"."appointments"("createdAt");

-- CreateIndex
CREATE INDEX "appointment_notifications_appointmentId_idx" ON "public"."appointment_notifications"("appointmentId");

-- CreateIndex
CREATE INDEX "appointment_notifications_recipientId_idx" ON "public"."appointment_notifications"("recipientId");

-- CreateIndex
CREATE INDEX "appointment_notifications_sent_idx" ON "public"."appointment_notifications"("sent");

-- AddForeignKey
ALTER TABLE "public"."appointments" ADD CONSTRAINT "appointments_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "public"."users"("healthId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."appointments" ADD CONSTRAINT "appointments_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "public"."users"("healthId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."appointment_notifications" ADD CONSTRAINT "appointment_notifications_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "public"."appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."appointment_notifications" ADD CONSTRAINT "appointment_notifications_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "public"."users"("healthId") ON DELETE CASCADE ON UPDATE CASCADE;
