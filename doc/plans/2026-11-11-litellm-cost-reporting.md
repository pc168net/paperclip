# Implementation Plan: LiteLLM Gateway Cost Reporting

Support LiteLLM Gateway cost reporting in Paperclip's custom OpenAI-compatible adapter by reading LiteLLM `spend`/`cost` fields, `x-litellm-response-cost` headers, and querying the `/spend/calculate` endpoint when costs are omitted.

## User Intent & Requirements
When agents use LiteLLM Gateway (or OpenAI-compatible providers with LiteLLM spend metrics):
- Response payload may provide `spend`, `usage.spend`, `response_cost`, `usage.response_cost`, or header `x-litellm-response-cost`.
- If response omits cost but includes token counts, the adapter should optionally query `POST /spend/calculate` on the Gateway to obtain the authoritative calculated cost.
- If `/spend/calculate` fails (404, timeout, network error), the run must not fail; it must safely retain unpriced status as a fallback.
- Successfully captured LiteLLM costs should be recorded as `costStatus: "reported"` with appropriate `pricingProvenance`.

## Proposed Changes

### 1. `server/src/adapters/custom-local-usage.ts`
- Export `parseCost(value: unknown): { costUsd: number; costUsdExact: string } | undefined` for reuse.
- Export `parseSpendCalculateResponse(data: unknown): { costUsd: number; costUsdExact: string } | undefined`.
- Update `parseCustomProviderUsage`:
  - Accept optional `headers?: Headers | Record<string, string | null | undefined>`.
  - Check `usage.cost ?? usage.spend ?? usage.response_cost ?? body.cost ?? body.spend ?? body.response_cost ?? headerCost`.
  - Set `pricingProvenance` appropriately based on the detected source (`custom-openai-compatible/v1`, `litellm-spend/v1`, or `litellm-header/v1`).

### 2. `server/src/adapters/custom-local.ts`
- Implement `tryCalculateSpend(baseUrl, model, usage, authHeader, signal)`:
  - Calls `POST ${baseUrl}/spend/calculate` with `{ model, prompt_tokens, completion_tokens }`.
  - Uses bounded timeout (e.g. 3000ms).
  - Handles bare number, object with `spend`/`cost`, or decimal string responses.
  - Safely catches and suppresses any errors (network, HTTP 404/500, parsing).
- In `executeCustom`:
  - Pass `response.headers` into `parseCustomProviderUsage(parsed, response.headers)`.
  - If `parsedUsage.costUsd == null` and valid `parsedUsage.usage` is present, call `tryCalculateSpend`.
  - If cost is resolved via `/spend/calculate`, populate `costUsd`, `costUsdExact`, `costStatus = "reported"`, and `pricingProvenance = { source: "provider_reported", version: "litellm/spend-calculate", evidence: ... }`.

### 3. Tests
- `server/src/adapters/custom-local-usage.test.ts`:
  - Test `usage.spend` and `body.spend`.
  - Test `response_cost` and `usage.response_cost`.
  - Test `x-litellm-response-cost` header.
  - Test precedence: `usage.cost` > `usage.spend` > `body.spend` > header.
  - Test `parseSpendCalculateResponse` handling bare numbers, objects, and strings.
- `server/src/adapters/custom-local.test.ts`:
  - Test response containing `usage.spend`.
  - Test response containing header `x-litellm-response-cost`.
  - Test fallback to `POST /spend/calculate` when cost is absent.
  - Test safe fallback to unpriced when `/spend/calculate` returns 404 or network error.

## Verification Plan
1. `cd paperclip && ./node_modules/.bin/vitest run server/src/adapters/custom-local-usage.test.ts`
2. `cd paperclip && ./node_modules/.bin/vitest run server/src/adapters/custom-local.test.ts`
3. `cd paperclip && ./node_modules/.bin/tsc -b server/tsconfig.json`
