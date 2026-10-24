# Task 10 report: Claude OAuth binding fixture alignment

## Scope

Updated only `server/src/__tests__/agents-claude-oauth-binding.test.ts` production-facing fixture inputs. The production duplicate-agent guard was not changed.

The intentional duplicate fixture creates now explicitly send `allowDuplicate: true`:

- replay of an already-consumed claim;
- already-consumed branch in the identical-error test;
- both concurrent claim-create requests;
- six same-company inherited-binding child creates that intentionally share the seeded parent role.

Non-duplicate creates, including first creates, cross-company inheritance, and unknown-parent inheritance, remain unchanged.

## RED evidence

Before the fixture update:

```sh
pnpm exec vitest run --project @paperclipai/server --no-file-parallelism --maxWorkers=1 server/src/__tests__/agents-claude-oauth-binding.test.ts
```

Result: `51 tests | 9 failed | 42 passed`.

Every failure was one of the diagnosed scenarios and was stopped by the existing 422 duplicate name/role guard before its intended OAuth claim assertion.

## GREEN evidence

After the fixture update, the same command passed:

```text
Test Files  1 passed (1)
Tests       51 passed (51)
```

## Broader verification

`pnpm test` was attempted twice. The first attempt exceeded the 120-second execution limit. A second attempt ran for ten minutes and exited nonzero before completion after reporting an unrelated failure:

```text
server/src/__tests__/tool-access-service.test.ts
× excludes unassignable agents from tests even for a session instance admin
```

No production changes were made to investigate or fix that out-of-scope failure.

## Notes

Vitest emitted its pre-existing Vite native-config deprecation warning on focused and broader runs. It did not affect the focused result.
