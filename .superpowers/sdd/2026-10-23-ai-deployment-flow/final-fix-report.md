# Final fix report

## Root cause
Deployment CRUD/verify/delete used `canManageAiConnections()` only, so the connection creator/owner path was excluded even though the approved policy allows owner, company admin/owner, or `tools:manage_connections`.

## Changes
- `server/src/routes/ai-connections.ts`: added owner-aware deployment auth and applied it to deployment read/manage routes.
- `ui/src/components/ai-connections/ManagedAiConnectionDetails.tsx`: show deployment controls when the loaded connection belongs to the current user.
- `server/src/__tests__/ai-connections.test.ts`: updated the deployment auth regression to prove the owner path now works.
- `ui/src/components/ai-connections/ManagedAiConnectionDetails.test.tsx`: updated owner/non-owner coverage for deployment controls.

## Verification
- `pnpm --filter @paperclipai/server exec vitest run src/__tests__/ai-connections.test.ts -t "allows a connection owner without manager permission to mutate deployments"`
  - `Test Files  1 passed (1)`
  - `Tests  1 passed | 117 skipped (118)`
- `pnpm --filter @paperclipai/server exec vitest run src/__tests__/ai-connections.test.ts -t "authorizes deployment reads and mutations by grant and manager scope"`
  - `Test Files  1 passed (1)`
  - `Tests  1 passed | 117 skipped (118)`
- `pnpm --filter @paperclipai/ui exec vitest run src/components/ai-connections/ManagedAiConnectionDetails.test.tsx src/components/ai-connections/AiConnectionDeploymentManager.test.tsx`
  - `Test Files  2 passed (2)`
  - `Tests  5 passed (5)`
- `pnpm --filter @paperclipai/server exec tsc --noEmit`
  - completed successfully
- `pnpm --filter @paperclipai/ui typecheck`
  - `Storybook map: 284 files, 2731 stories. Structure only; no runtime proof.`
- `pnpm check:token-gates`
  - `All gates clean.`

## Notes
- A full unfiltered `src/__tests__/ai-connections.test.ts` run still has unrelated pre-existing failures, so the deployment-owner path was verified with targeted tests instead.

## 2026-10-23 NewAgentSetup deployment test fix
Root cause: `ui/src/components/new-agent/NewAgentSetup.deployment.test.tsx` mocked `../onboarding/onboarding-motion` with only `stepMotion`, but `FooterNav` also imports `CTA_WIDTH` and `CTA_LABEL_IN`, which triggered Vitest export errors before the stale/failed assertions could run.

Change: switched that mock to a partial actual-module mock so the test keeps the real named exports and only overrides `stepMotion`.

Verification evidence:
- `pnpm --filter @paperclipai/ui exec vitest run src/components/new-agent/NewAgentSetup.deployment.test.tsx`
  - `Test Files  1 passed (1)`
  - `Tests  2 passed (2)`
- `pnpm --filter @paperclipai/ui typecheck`
  - `Storybook map: 284 files, 2731 stories. Structure only; no runtime proof.`
