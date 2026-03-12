-- Remove unique constraint to allow multiple logs per task per day
ALTER TABLE "TaskLog" DROP CONSTRAINT IF EXISTS "TaskLog_taskId_date_key";

