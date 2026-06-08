-- Add shipheroOrderId to fc_replacement_parts
ALTER TABLE shipcore.fc_replacement_parts ADD COLUMN IF NOT EXISTS "shipheroOrderId" TEXT;
