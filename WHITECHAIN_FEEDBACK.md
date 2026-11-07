# Whitechain feedback

From the QuietPay team (ETHGlobal Mumbai, Operate track). We built a gasless USDT checkout, subscriptions and refunds on Whitechain Sepolia, so most notes are about what a payments app needs from the chain, the test token and the docs. Each note says what happened, where, and how we worked around it.

## Top three
1. **Give builders a way to get test USDT.** The faucet only gives WBT. Every payments demo needs USDT in customer wallets; we had to run our own treasury wallet.
2. **Document the test USDT properly:** that it's a `TetherTokenV2` proxy, that it supports EIP-2612 and EIP-3009 (with the `bytes signature` overloads), and its EIP-712 domain. These are exactly what makes gasless payments possible on Whitechain, and they're currently undocumented.
3. **Publish copy-paste chain config and tooling settings:** a viem/wagmi/Privy chain object for 1874, the required solc 0.8.30 + `prague` settings for verification, the RPC rate limit and the `eth_getLogs` range limit.

## Contracts, API and chain
Notes from the contract, relayer and indexer side, taken from what the build needed (see `CLAUDE.md` fixed decisions and `docs/BUILD_PLAN.md` risks).

- **Explorer verification needs an exact toolchain.** QuietPay only verifies on the Blockscout explorer with **solc 0.8.30 and `evm_version = prague`**, which we pinned in `foundry.toml` from the start. Foundry's defaults differ, so a newcomer following a generic Foundry guide can deploy fine and then fail verification. *Suggestion:* put the required compiler settings and a working `forge verify-contract … --verifier blockscout --verifier-url https://explorer.testnet.whitechain.io/api/` line on the "deploy a contract" page.
- **The test USDT is a proxy.** `0xcedf…55a7` proxies to `TetherTokenV2`. The functions we need (`permit`, `receiveWithAuthorization`, `transferWithAuthorization`, each in `(v,r,s)` and `bytes signature` overloads) are only visible on the implementation. *Workaround:* read the implementation ABI and use the `bytes signature` overloads. *Suggestion:* document which standards the test USDT supports (EIP-2612, EIP-3009) and link the implementation.
- **EIP-712 domain of the test USDT isn't written down.** We computed `{ name: "Tether USD", version: "1", chainId: 1874, verifyingContract: 0xcedf…55a7 }` and asserted it equals the on-chain `DOMAIN_SEPARATOR()` (`0xcdcf…2a25`) before building anything on it.
- **Getting test USDT** for demo customers needed a workaround (the faucet gives WBT only). We kept one funded wallet as a demo treasury.
- **Relayer gas.** The faucet's 0.5 WBT per GitHub account per day is enough for development, but a relayer that pays gas for every customer and merchant action burns through it during demos. *Suggestion:* a higher limit for verified hackathon projects, or a sponsor faucet at the booth.
- **RPC rate limit (50 requests/s per IP)** is fine once known; our indexer polls every 2 seconds with batched calls and one shared client. Publishing the limit and the maximum `eth_getLogs` block range in the RPC docs would save guessing.

## Frontend and demo
Specific notes from building QuietPay's web app, the hosted checkout and the Swag Counter demo store on Whitechain Sepolia. Each line says what happened, where, and how we worked around it.

## What worked well
- **The public RPC is browser-friendly.** `https://rpc.testnet.whitechain.io` answers CORS preflights with `access-control-allow-origin: *`, so our `/admin` panel reads contract events with viem straight from the browser, with no backend proxy. JSON-RPC batching also worked, which kept block-timestamp lookups fast.
- **Blockscout explorer links** are stable and readable (`/tx/<hash>`, `/address/<addr>`), so every finished payment, refund and cancel in our UI links to a real explorer page that judges and customers can open.
- **Official test USDT supports EIP-3009 and EIP-2612.** That's what makes a gasless checkout possible: the customer signs, our relayer pays the gas. Not every testnet stablecoin has both.
- **Plain EVM.** Privy embedded wallets, viem and EIP-712 signing worked on chain 1874 without any Whitechain-specific code once the chain was defined.

## What was hard or missing
- **No way to get test USDT.** The faucet gives WBT only (0.5 WBT per GitHub account per day). For a payments track this is the main blocker: every demo customer needs USDT. *Workaround:* one teammate's wallet acted as a treasury and sent test USDT to demo wallets; we built a `/demo/fund` page on top of it. *Suggestion:* a USDT button on the faucet, or a documented mint/drip for the official test USDT.
- **Whitechain Sepolia isn't in common chain lists** (viem's `chains`, Privy's supported chains, wallet presets). *Workaround:* `defineChain({ id: 1874, … })` in our shared package and Privy's custom-chain config. *Suggestion:* publish a copy-paste chain object (viem / wagmi / Privy) in the docs, including the explorer API URL.
- **The test USDT's EIP-712 domain isn't documented.** We had to read `name()`, `version` and `DOMAIN_SEPARATOR()` on-chain and assert our computed separator matched before building signatures on it. *Suggestion:* list the domain (`Tether USD`, version `1`, chain 1874, proxy address) next to the token address.
- **`eth_getLogs` range limits aren't documented.** We didn't know the maximum block range per call, so the admin panel reads events in 5,000-block chunks to stay safe. *Suggestion:* state the limit in the RPC docs.
- **No brand or press kit.** whitechain.io serves its header logo at `/logo.svg`, but there's no linked brand kit with light/dark variants or usage rules. The logo is drawn for light backgrounds; turning it white for a dark hero flattens the mark. *Workaround:* we show it on a white chip in its real colours. *Suggestion:* a small brand page with SVGs for light and dark backgrounds.

## Small things
- The faucet's per-day limit is fine for one wallet but tight when a relayer, a deployer and a few demo wallets all need gas during a 36-hour build.
- A short "build a gasless checkout on Whitechain" guide (EIP-3009 + relayer) would fit the Operate track well; we'd happily contribute ours.
