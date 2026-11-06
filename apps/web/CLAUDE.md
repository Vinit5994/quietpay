# apps/web: QuietPay web app (Person B)

Hosted checkout `/c/[sessionId]`, payment links `/l/[slug]`, receipts `/r/[paymentId]`, customer portal `/portal`, merchant dashboard `/dashboard/*`, demo funding `/demo/fund`. Port 3001.

- Talk to the API only through `lib/api.ts` (`api("endpointKey", {...})`). It validates bodies and responses with the zod schemas from `@quietpay/shared`. Never call `fetch` on the API directly.
- `@quietpay/shared` is Person A's package (`packages/shared`). Use its `Endpoints` names and types; never redefine API shapes locally. Ask Person A for additions.
- The frontend never needs the contract ABI. It signs the typed data returned by `publicPrepareSession` (via the wallet, which converts uint strings with `lib/wallet/typed-data.ts`).
- Wallets go through the `Wallet` interface in `lib/wallet/` (`useWallet()`). `NEXT_PUBLIC_WALLET_MODE=privy` + `NEXT_PUBLIC_PRIVY_APP_ID` uses Privy (email/Google, embedded wallet on chain 1874, `lib/wallet/privy-wallet.tsx`); `dev` uses the browser demo wallet. Never import Privy outside `lib/wallet/`.
- Privy's optional Solana helpers need `@solana/kit` 8.x; the direct `@solana/*` deps in package.json pin that so the build resolves. Don't remove them.
- Money: amounts are decimal strings from the API; display with `formatUsdt`. Never use JS numbers for amounts.
- Customer-facing pages never mention gas, WBT, chains or networks. Every finished on-chain action shows an explorer link (`explorerTx`).
- The visual design is up to the developer. The specs only fix pages, states, data and actions.
- Run: `pnpm dev` (port 3001), `pnpm typecheck`, `pnpm test`. Mock API: `cd ../../tools/mock-api && pnpm dev` (port 4010).
