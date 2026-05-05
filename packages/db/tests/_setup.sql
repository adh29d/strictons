-- ============================================================================
-- pgTAP test setup. Run once before any *.spec.sql files. Idempotent.
-- ============================================================================

create extension if not exists pgtap;
