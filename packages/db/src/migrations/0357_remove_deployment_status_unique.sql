-- Older partial deployments schema incorrectly made status unique per connection.
-- Multiple stale/failed/verified deployment rows are valid and required.
DROP INDEX IF EXISTS "ai_deployments_company_connection_status_idx";
