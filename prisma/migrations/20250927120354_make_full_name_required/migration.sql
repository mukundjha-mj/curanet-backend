/*
  Warnings:

  - Made the column `firstName` on table `health_profiles` required. This step will fail if there are existing NULL values in that column.
  - Made the column `lastName` on table `health_profiles` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "public"."health_profiles" ALTER COLUMN "firstName" SET NOT NULL,
ALTER COLUMN "lastName" SET NOT NULL;
