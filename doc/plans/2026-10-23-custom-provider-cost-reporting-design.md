# Custom Provider Cost Reporting Design

## Intent

Make Custom/OpenAI-compatible runs appear in Paperclip Costs when the provider
returns an actual charge, without inventing a price from token counts.

## Current Evidence

- `server/src/services/run-cost-accounting.ts` already persists provider-reported
  `costUsd`, `costUsdExact`, or `cacheAdjustedCostUsd` into `cost_events`.
- `server/src/services/usage-receipts.ts` preserves provider pricing provenance
  and usage totals.
- `server/src/adapters/custom-local.ts` currently returns execution status but
  does not map a provider response's cost field into the adapter usage receipt.
- The Costs UI therefore shows token usage while recorded charges remain zero
  when Custom responses contain no mapped cost.

## Chosen Approach

Extend the Custom adapter's response parsing to accept only an explicit
provider-reported cost field from the OpenAI-compatible response/runner result,
normalize it into the existing `costUsdExact`/`costUsd` usage receipt fields,
and preserve `pricingProvenance.source = "provider_reported"`.

The existing accounting pipeline then creates the normal `cost_events` row and
the Costs page displays the charge. No model price table, token-based fallback,
or Connector pricing UI is added in this change.

## Goals

- Preserve input, cached-input, and output token counts.
- Persist an explicit provider-reported cost exactly once per run.
- Mark the resulting event as reported, not estimated.
- Keep zero-cost/subscription responses distinguishable from missing cost.
- Reject malformed, negative, or non-finite cost values without crashing the run.

## Non-goals

- Do not calculate cost from tokens when the provider omits cost.
- Do not fetch current provider pricing from the network.
- Do not change existing pricing for Anthropic, Codex, or other adapters.
- Do not add a Custom deployment pricing form.

## Verification

- Custom adapter parser tests for explicit cost, exact decimal preservation,
  zero cost, missing cost, and malformed/negative cost.
- End-to-end accounting regression proving a Custom usage receipt with provider
  cost creates a `cost_events` row with the same token counts and non-zero
  `costCents`.
- Regression proving a token-only Custom receipt remains unpriced with zero
  charges rather than receiving an invented estimate.
- Existing focused Custom adapter and cost-accounting suites remain passing.
