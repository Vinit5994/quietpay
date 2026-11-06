# apps/store: Swag Counter (Person B)

A demo merchant: a hackathon swag store that takes USDT through QuietPay. Port 3000.

- **Behave like a real merchant.** Talk to QuietPay only through `@quietpay/node` (Person A's SDK, added in B6) and redirects to the hosted checkout. Never import `@quietpay/shared`, `apps/api` or `apps/web`.
- Keep the checkout server action and the webhook route as short as in `docs/SPEC_FRONTEND.md`; they're shown in the demo video.
- Webhooks are delivered at least once: treat the event `id` as an idempotency key.
- Look: ETHGlobal's visual style from `docs/design/ethglobal-reference/`, with our own store name and logo (no ETHGlobal logo or artwork).
- The store has its own small data store for orders and boxes; it never reads QuietPay's database.
- Run: `pnpm dev` (port 3000), `pnpm typecheck`, `pnpm test`.
