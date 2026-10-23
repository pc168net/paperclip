# Azure reconnect fix report

## Evidence

- Focused manager test: `pnpm --filter @paperclipai/ui exec vitest run src/components/ai-connections/AiConnectionDeploymentManager.test.tsx` ✅
- Broader ai-connection UI tests: `pnpm exec vitest run src/components/ai-connections/AiProviderSetup.test.tsx src/components/ai-connections/ManagedAiConnectionDetails.test.tsx src/components/ai-connections/AiConnectionUsagePanel.test.tsx src/components/ai-connections/useConnectionModels.test.tsx src/components/ai-connections/AiConnectionField.test.tsx src/components/ai-connections/AiConnectionDeploymentManager.test.tsx src/components/ai-connections/useLocalAiLogin.test.tsx src/components/ai-connections/AiConnectionAuth.test.tsx src/components/ai-connections/AiConnectionSelect.test.tsx` ✅
- UI typecheck: `pnpm typecheck` in `ui/` ✅
- Token gates: `pnpm check:token-gates` ✅
- Server focused regression: `pnpm --filter @paperclipai/server exec vitest run src/services/ai-deployments.test.ts -t "retries Azure v1 probes with bearer API-key authentication"` ✅
- Server deployment service tests: `pnpm --filter @paperclipai/server exec vitest run src/services/ai-deployments.test.ts` ✅
- Server typecheck: `pnpm --filter @paperclipai/server exec tsc --noEmit` ✅

## Change

- Render `deployment.lastError` under failed/stale deployment rows for managers, while preserving read-only filtering for non-managers and keeping actions unchanged.
- Add Azure gateway fallback in deployment verification: try `api-key` first, retry once with `Authorization: Bearer <credential>` on 401/403 for `*.openai.azure.com`, and keep safe error classification.

## Notes

- Did not render provider/API-key/body details; only the safe server-provided `lastError` string.
- Repo already had unrelated local modifications; left them untouched.
