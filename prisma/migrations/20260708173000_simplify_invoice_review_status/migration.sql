-- Simplify invoice review workflow to pending review / hold / reviewed.
-- The legacy enum values remain for compatibility, but new invoices default
-- to the pending review state used by the simplified UI.

ALTER TABLE shipcore.fc_invoices
  ALTER COLUMN status SET DEFAULT 'price_review';

UPDATE shipcore.fc_invoices
SET status = 'price_review'
WHERE status IN ('received', 'discrepancy_found');
