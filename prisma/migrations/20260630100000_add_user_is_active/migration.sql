-- Add isActive column to fc_user table
ALTER TABLE shipcore."fc_user" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT TRUE;
