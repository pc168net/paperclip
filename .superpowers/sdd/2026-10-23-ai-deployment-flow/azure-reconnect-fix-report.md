# Azure reconnect fix evidence

## What changed
- `validateAiApiKey` now skips `/models` validation for custom gateway URLs whose hostname ends with `.openai.azure.com`.
- Non-Azure custom gateway validation still probes `/models` and classifies upstream errors as before.

## Verification

### Focused regression test
Command:
```sh
pnpm vitest run server/src/services/ai-api-key-test.test.ts -t "does not use Azure's global /models catalog when saving a connection"
```
Result:
```text
Test Files  1 passed (1)
Tests       1 passed | 21 skipped (22)
```

### Full ai-api-key-test file
Command:
```sh
pnpm vitest run server/src/services/ai-api-key-test.test.ts
```
Result:
```text
Test Files  1 passed (1)
Tests       22 passed (22)
```

### Server tsc
Command:
```sh
pnpm --filter @paperclipai/server exec tsc --noEmit -p tsconfig.json
```
Result:
```text
(no output)
```

### Packaged server typecheck attempt
Command:
```sh
pnpm --filter @paperclipai/server typecheck
```
Result:
```text
sh: cargo: command not found
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @paperclipai/paperclip-runner@0.0.0 build
```
