# Evidence: real transactions on Whitechain Sepolia (chain 1874)

Every main-flow transaction uses the official test USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`.

| Item | Link |
|---|---|
| QuietPay contract (verified) | _A5_ |
| USDT (TetherTokenV2 proxy) | https://explorer.testnet.whitechain.io/address/0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7 |

| Step | Tx link | Notes |
|---|---|---|
| Deploy QuietPay | | A5 |
| setOperator(relayer A) | | A5 |
| setOperator(relayer B) | | A5 |
| First payment (pay, 1.00 USDT) | | A5, `pnpm first-payment`; payer pays no gas |
| Checkout payment via API | | A7 |
| Payment link payment | | A11 |
| Subscribe (first charge) | | A9 |
| Renewal | | A9 |
| Failed renewal (past due) | | A9 |
| Cancel (nonpayment / customer) | | A9 |
| Refund (partial) | | A10 |
| Refund (second partial) | | A10 |
