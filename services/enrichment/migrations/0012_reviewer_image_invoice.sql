-- Migration 0012: Reviewer-authenticated image invoice uploads
ALTER TABLE receipts DROP CONSTRAINT IF EXISTS receipts_source_check;
ALTER TABLE receipts ADD CONSTRAINT receipts_source_check
  CHECK (source IN ('MOBILE', 'MANUAL', 'IMAGE_UPLOAD'));
