-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GoalPriority') THEN
    CREATE TYPE "GoalPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
  END IF;
END $$;

-- AlterTable
ALTER TABLE "savings_goals" ADD COLUMN IF NOT EXISTS "priority" "GoalPriority" NOT NULL DEFAULT 'MEDIUM';
ALTER TABLE "savings_goals" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
