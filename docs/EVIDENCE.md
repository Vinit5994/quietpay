# Evidence: real transactions on Whitechain Sepolia (chain 1874)

Every main-flow transaction uses the official test USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`.

| Item | Link |
|---|---|
| QuietPay contract (verified) | https://explorer.testnet.whitechain.io/address/0x8ed9E91D00CbeB77F492863dc101C073F9152aC5 |
| USDT (TetherTokenV2 proxy) | https://explorer.testnet.whitechain.io/address/0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7 |

| Step | Tx link | Notes |
|---|---|---|
| Deploy QuietPay | https://explorer.testnet.whitechain.io/tx/0x02c6298b49bfb14b0d500941e62ba7d52ed8c9cd767000f5174cdde057d82b22 | A5, block 12390829, 3.31M gas |
| setOperator(relayer A) | https://explorer.testnet.whitechain.io/tx/0x6a8b7474ceb2816862f25d7345e3a8fac19744ac94d3d863da0af67849e624a6 | A5, Person A's API relayer |
| setOperator(relayer B) | https://explorer.testnet.whitechain.io/tx/0xa5545463f24ee71a40413eb514c7f34388ea28a6d376c2b0e880df36bf85a118 | A5, Person B's API relayer `0xb033…d709` |
| Register test merchant #1 | https://explorer.testnet.whitechain.io/tx/0x76841c89bb9f7fbfb93523f530139baca4956a7119b828ed3206582fbd5deb05 | A5, `pnpm first-payment` |
| First payment (pay, 1.00 USDT) | https://explorer.testnet.whitechain.io/tx/0x43fb0019d4f97cad1549b57a7d52d943e4bfb9d1ce987df040d45a9f8d076bca | A5, merchant #1, EIP-3009 signature, 243,822 gas paid by the relayer |
| Checkout payment via API | https://explorer.testnet.whitechain.io/tx/0x988fb089aeed108489056a856d653375d6280e2b194abc705cb10051e22924c6 | A7, `pnpm pay-session`: /prepare → payer signs → /submit, relayer pays 243,754 gas |
| **M2:** Swag Counter hoodie, 25.00 USDT via hosted checkout + Privy | https://explorer.testnet.whitechain.io/tx/0xb0696e753e80ce40e1ac677827bc50d2a766dc65f86cea8c86a25f92971c7026 | M2, store → `@quietpay/node` → /c/sess_… → Privy signs → relayer A pays gas → `payment.succeeded` → order Paid; block 12402867 |
| M2: register Person B's Swag Counter (merchant #3) | https://explorer.testnet.whitechain.io/tx/0xa8c549428a78d7e7961f94d0af0877be59017eb5bbb3723076630fb3aa1e9718 | M2, B's local API seed |
| M2: fund the demo customer (20.00 USDT) | https://explorer.testnet.whitechain.io/tx/0x102c72de80bc1402213612c6cd19dfab2b297839074693f7ae0f340420f0b707 | testnet funding of the Privy wallet, not part of checkout |
| Payment link payment | | A11 |
| Subscribe (first charge) | | A9 |
| Renewal | | A9 |
| Failed renewal (past due) | | A9 |
| Cancel (nonpayment / customer) | | A9 |
| Refund (partial) | | A10 |
| Refund (second partial) | | A10 |
