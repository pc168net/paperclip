# AI deployment migration fix report

## RED
```text
 RUN  v5.0.3 /Users/bruce/Antigravity/paperclip/paperclip/packages/db

 ❯ src/ai-deployments-migration.test.ts (2 tests | 1 failed) 1445ms
   ❯ AI deployment migration backfill (2)
     × upgrades an existing partial deployment table without recreating it 878ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/ai-deployments-migration.test.ts > AI deployment migration backfill > upgrades an existing partial deployment table without recreating it
PostgresError: relation "ai_deployments" already exists
 ❯ ErrorResponse ../../node_modules/.pnpm/postgres@3.4.9_patch_hash=sryle6qd5qfmnxvoebal4gashi/node_modules/postgres/src/connection.js:819:30
 ❯ handle ../../node_modules/.pnpm/postgres@3.4.9_patch_hash=sryle6qd5qfmnxvoebal4gashi/node_modules/postgres/src/connection.js:493:6
 ❯ Socket.data ../../node_modules/.pnpm/postgres@3.4.9_patch_hash=sryle6qd5qfmnxvoebal4gashi/node_modules/postgres/src/connection.js:324:9

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
   Start at  07:50:49
   Duration  2.06s (tests 72%, transform 16%, import 12%)

undefined
/Users/bruce/Antigravity/paperclip/paperclip/packages/db:
 ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command failed with exit code 1: vitest run src/ai-deployments-migration.test.ts
Exited with code 1
```

## GREEN
```text
 RUN  v5.0.3 /Users/bruce/Antigravity/paperclip/paperclip/packages/db


 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  07:53:46
   Duration  3.29s (import 57%, tests 34%, transform 9%)
```

## Migration checks
```text
> @paperclipai/db@0.3.1 check:migrations /Users/bruce/Antigravity/paperclip/paperclip/packages/db
> tsx src/check-migration-numbering.ts && tsx src/check-migration-safety.ts

Migration safety check passed: 20 historical finding(s) covered by baseline (1 stale baseline id(s) ignored).
```
