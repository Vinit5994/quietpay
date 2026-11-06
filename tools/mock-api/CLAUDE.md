# tools/mock-api (Person B)

Fake QuietPay API on port 4010, used by apps/web and apps/store until the real API is ready. See README.md.

- `src/handlers.ts` has one handler per endpoint in `@quietpay/shared`'s `Endpoints` map (Person A's `packages/shared`). The `Handlers` type makes TypeScript fail if one is missing, so when the shared map gains an endpoint, add its handler here.
- Route registration, auth and validation live in `src/app.ts`. Responses are validated against the shared schemas before sending.
- Internal records use bigint base units (`src/state.ts`); serializers convert to the API shapes.
- Timed behaviour (payment confirmation, renewals, refunds) is in `src/engine.ts`. Webhook signing and retries are in `src/webhooks.ts`.
- Webhooks are signed with `signWebhook` from `@quietpay/node`, so the store's `verifyWebhook` always accepts them.
- Run `pnpm typecheck && pnpm test` before committing.
