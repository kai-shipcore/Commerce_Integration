-- Add 'complete' value to fc_container_status enum for marking fully received containers.

ALTER TYPE shipcore.fc_container_status ADD VALUE IF NOT EXISTS 'complete';
