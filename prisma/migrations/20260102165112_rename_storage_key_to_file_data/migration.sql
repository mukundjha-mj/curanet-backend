-- AlterTable: Rename storageKey column to fileData
-- This changes the column from storing file paths to storing base64 encoded file content

-- Step 1: Rename the column
ALTER TABLE "file_uploads" RENAME COLUMN "storageKey" TO "fileData";

-- Step 2: Add comment for documentation
COMMENT ON COLUMN "file_uploads"."fileData" IS 'Base64 encoded file content stored directly in database';
