# Task 1 Report — Normalize deployment schema and migration

## Summary
- Normalized the AI deployment schema to company-scoped verified deployments.
- Added the connection credential epoch contract.
- Added a focused DB schema test covering the deployment FK/uniqueness rules.
- Generated migration updates and refreshed the DB snapshot set.

## Changes
- `packages/db/src/schema/ai_connection_routing.ts`
  - Added `displayName`, `verifiedCredentialEpoch`, and `lastError` to `aiDeployments`.
  - Switched deployment status to `stale | verified | failed` with schema checks.
  - Kept the company/connection composite foreign key.
- `packages/db/src/schema/tool_access.ts`
  - Added `toolConnections.credentialEpoch` with default `1`.
- `packages/shared/src/ai-connections.ts`
  - Exported the normalized deployment contract types:
    - `AiDeploymentStatus`
    - `CreateAiDeployment`
    - `AiDeploymentSummary`
  - Updated the create schema to accept `displayName?`.
- `packages/db/src/migrations/0355_wakeful_doctor_faustus.sql`
  - Normalized the `ai_deployments` table and backfill SQL.
- `packages/db/src/migrations/0356_happy_lilandra.sql`
  - Added the generator’s follow-up default-setting migration.
- `packages/db/src/migrations/meta/_journal.json`
  - Updated to include the new migration entry.
- `packages/db/src/migrations/meta/0355_snapshot.json`
  - Refreshed the schema snapshot for the deployment/credential changes.
- `packages/db/src/migrations/meta/0356_snapshot.json`
  - Added by generator for the follow-up migration.
- `packages/db/src/ai-deployments-schema.test.ts`
  - Added the focused schema contract test.

## Verification
- `pnpm --filter @paperclipai/db exec vitest run src/ai-deployments-schema.test.ts`
- `pnpm --filter @paperclipai/db check:migrations`
- `pnpm db:generate`

## Notes / Concerns
- `db:generate` produced a small follow-up migration (`0356_happy_lilandra.sql`) for default-setting changes after the main `0355` migration.
- The server route/service code still contains the older deployment field/status usage and will need the later flow tasks to consume the new shared contract.
