# apps/web: QuietPay web app (Person B)

Hosted checkout `/c/[sessionId]`, payment links `/l/[slug]`, receipts `/r/[paymentId]`, customer portal `/portal`, merchant dashboard `/dashboard/*`, demo funding `/demo/fund`. Port 3001.

- Talk to the API only through `lib/api.ts` (`api("endpointKey", {...})`). It validates bodies and responses with the zod schemas from `@quietpay/shared`. Never call `fetch` on the API directly.
- `@quietpay/shared` is currently a **temporary** link to `tools/mock-api/shared` (see its README). Import only from `@quietpay/shared`, never by relative path, so the A2 swap is a one-line change.
- The frontend never needs the contract ABI. It signs the typed data returned by `/prepare` (convert with `toSignableTypedData`).
- Wallets go through the `Wallet` interface in `lib/wallet/`. `NEXT_PUBLIC_WALLET_MODE=dev` uses the browser demo wallet; Privy arrives in B4.
- Money: amounts are decimal strings from the API; display with `formatUsdt`. Never use JS numbers for amounts.
- Customer-facing pages never mention gas, WBT, chains or networks. Every finished on-chain action shows an explorer link (`explorerTx`).
- The visual design is up to the developer. The specs only fix pages, states, data and actions.
- Run: `pnpm dev` (port 3001), `pnpm typecheck`, `pnpm test`. Mock API: `cd ../../tools/mock-api && pnpm dev` (port 4010).
