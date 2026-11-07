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
| Payment link payment (Sticker Pack, 3.00 USDT) | https://explorer.testnet.whitechain.io/tx/0xca989bc200392ebe34e1eae3be7e710272b7c9e994ec4b80639d42220d6317c4 | B10, `/l/sticker-pack` → fresh session → Privy signs; block 12407476 |
| Pop-up checkout (Swag Counter → QuietPay window → Paid) | https://explorer.testnet.whitechain.io/tx/0x6bc19c8cd267c91221c0e3b7b24a2c40b34567f6145219bf7ab58244e98fb7d6 | B10, store opens checkout in a pop-up, Privy signs, window posts back and closes, order Paid via webhook; gas from the merchant's funded gas balance |
| Subscribe (Builder Box, first charge 15.00 USDT) | https://explorer.testnet.whitechain.io/tx/0x7a120ed88d71504530f03c835542527830535a0380b10813013c70b61afb9b4f | B10, `Subscribed` (sub #1) + `PaymentReceived` kind 1 in one tx; Subscribe + Permit signatures |
| Automatic renewal (keeper) | https://explorer.testnet.whitechain.io/tx/0x000724492798b2977057cb784fdb91d44f66ea65d40f79606893f4cc28cc5af0 | B10, `Renewed` cycle 1 + 15.00 USDT charge; sent by the keeper, customer did nothing |
| Failed renewal (past due) | https://explorer.testnet.whitechain.io/tx/0xdb7451f7190c5b21a9ab4ac7081d3750ab146c9dc41877d03e127fad3ed0a087 | A9, `pnpm subscription-demo` on a 1.00 USDT / 2-minute "Evidence Box" plan (sub #2): wallet funded with exactly 2 periods, so the 3rd charge emits `RenewalFailed` and the subscription goes past due. Subscribe: https://explorer.testnet.whitechain.io/tx/0xceaffbce07d44a1417468de1804221d75571013bcd04ebb3b675e8ed640ebf53 · renewal: https://explorer.testnet.whitechain.io/tx/0x68e617b91ee2b1c1b96889cf2bd69032a6f7cd26752de3228a9e25ab7799ce8d · retry in grace (failed again): https://explorer.testnet.whitechain.io/tx/0xf2589f4ee483e0daa9cf409f3163e8cc9dc161059fd41814b4ee148459686339 |
| Cancel by customer (portal, gasless) | https://explorer.testnet.whitechain.io/tx/0xa77c063d4e4bd49822f63182ed78ee4a58a42816eb89583a78e80d33d8a6cb1e | B10, `SubscriptionCanceled` reason 0, CancelSubscription signature |
| Cancel for nonpayment (after grace) | https://explorer.testnet.whitechain.io/tx/0x210db3a7b13ebc6d133d30bd7a0cfa121243e76524eee7c2262e84470b76c3f7 | A9, same run: after the 60 s grace the keeper cancels sub #2, `SubscriptionCanceled` reason 1 (nonpayment) |
| Refund (partial, 5.00 of 25.00 USDT) | https://explorer.testnet.whitechain.io/tx/0x82eef7948b0fda1181af54a58fc77672d44ccf6db5965346609c1e9f7ffc42d9 | B10, dashboard refund modal; payout wallet signed EIP-3009; `Refunded` seq 0 |
| Refund (full, 25.00 of 25.00 USDT) | https://explorer.testnet.whitechain.io/tx/0x83588aa150a4f04b61b4305808fb1e9731495470b60ca55dcf2785695b3f0401 | Dashboard refund of `order_27977fcead`; payout wallet signed EIP-3009; `Refunded` with totalRefunded = amount, so the contract allows no further refund |
