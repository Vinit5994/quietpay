# apps/store: Swag Counter (Person B)

A demo merchant: a hackathon swag store that takes USDT through QuietPay. Port 3000.

- **Behave like a real merchant.** Talk to QuietPay only through `@quietpay/node` (`lib/quietpay.ts`, server-only) and redirects to the hosted checkout. Never import `@quietpay/shared`, `apps/api` or `apps/web`.
- Webhooks: `app/api/webhooks/quietpay/route.ts` verifies with the SDK, then `lib/webhook-handler.ts` applies the event (idempotent on event id). `lib/sync.ts` re-checks a pending order's session when its page is viewed, in case a webhook was missed.
- Local dev while port 3000 is busy: `STORE_URL=http://localhost:3002 next start -p 3002`, and run the mock with `MOCK_WEBHOOK_URL=http://localhost:3002/api/webhooks/quietpay`.
- Keep the checkout server action and the webhook route as short as in `docs/SPEC_FRONTEND.md`; they're shown in the demo video.
- Webhooks are delivered at least once: treat the event `id` as an idempotency key.
- Look: ETHGlobal's visual style from `docs/design/ethglobal-reference/`, with our own store name and logo (no ETHGlobal logo or artwork).
- The store has its own small data store for orders and boxes; it never reads QuietPay's database.
- Run: `pnpm dev` (port 3000), `pnpm typecheck`, `pnpm test`.
