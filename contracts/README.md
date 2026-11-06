# contracts

`QuietPay.sol` plus Foundry tests. The spec is in `docs/SPEC_CONTRACTS.md`.

```bash
forge build
forge test                       # unit tests (the fork test skips)
WHITECHAIN_SEPOLIA_RPC_URL=https://rpc.testnet.whitechain.io forge test --match-path test/Fork.t.sol -vv
```

## Deploy to Whitechain Sepolia (A5)

Keep keys in your shell. Never put them in a file.

```bash
export WHITECHAIN_SEPOLIA_RPC_URL=https://rpc.testnet.whitechain.io
export DEPLOYER_PK=0x...            # needs WBT (deploy + 2 setOperator ≈ 4.5M gas)
export RELAYER_A=0x...              # Person A's API relayer
export RELAYER_B=0x...              # Person B's API relayer (optional, can be added later)
export OWNER=0x...                  # optional; defaults to the deployer

cd contracts
forge script script/Deploy.s.sol:Deploy --rpc-url whitechain_sepolia --private-key $DEPLOYER_PK            # dry run
forge script script/Deploy.s.sol:Deploy --rpc-url whitechain_sepolia --private-key $DEPLOYER_PK --broadcast
```

The script writes `deployments/whitechain-sepolia.json` (`QuietPay`, `deployBlock`).

Verify on Blockscout. The constructor owner is the **deployer** address, even if `OWNER` differs:

```bash
QP=$(jq -r .QuietPay deployments/whitechain-sepolia.json)
forge verify-contract $QP src/QuietPay.sol:QuietPay --rpc-url whitechain_sepolia \
  --verifier blockscout --verifier-url https://explorer.testnet.whitechain.io/api/ \
  --constructor-args $(cast abi-encode "constructor(address,address)" 0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7 $(cast wallet address $DEPLOYER_PK))
```

Then, from the repo root:

```bash
pnpm abi:export                      # ABI + address into packages/shared
RELAYER_PK=0x... DEMO_TREASURY_PK=0x... pnpm first-payment
```

Add a relayer later: `cast send $QP "setOperator(address,bool)" $RELAYER_B true --rpc-url whitechain_sepolia --private-key $DEPLOYER_PK`.
