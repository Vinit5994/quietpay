# apps/api conventions (owner: Person A)

Spec: `docs/SPEC_API.md`. Shared shapes: `packages/shared/src/api-types.ts`.

- **Validate everything with zod from `@quietpay/shared`.** Parse every request body/query with the matching schema from the `Endpoints` map, and parse every response before sending it. The API must never drift from what Person B built against. Need a new field? Add it to `api-types.ts` (additive only) in the same PR.
- **Errors** always use the envelope `{ error: { code, message } }` with HTTP 400/401/402/404/409/422/429/500. Use the codes from SPEC_API (`session_expired`, `session_not_open`, `invalid_signature`, `insufficient_balance`, `amount_below_minimum`, `rate_limited`, `merchant_gas_budget_exhausted`, `refund_exceeds_payment`, decoded contract errors such as `order_already_paid`). Never leak stack traces.
- **Money:** amounts in HTTP are decimal strings (`"25.00"`, max 2 decimals on input). Inside the API and in the DB they are base units (`bigint`, 6 decimals; store as TEXT/INTEGER, never REAL). Convert only with `toUnits` / `fromUnits` from `@quietpay/shared/money`. Never use JS `number` for an amount.
- **IDs** are prefixed strings: `sess_`, `pay_`, `sub_`, `plan_`, `link_`, `re_`, `evt_`.
- **The relayer (`src/relayer/`) is the only code that sends transactions.** Every send goes through the 10 checks in SPEC_API, in order. Print target + function before any write in scripts.
- **Secrets** come from env vars only (`.env.example` lists them). Merchant signer keys are encrypted with `ENCRYPTION_KEY`; secret keys are stored as SHA-256 hashes.
- Tests: vitest in `test/`, use `app.request()` and a mocked chain client; no network in unit tests.
