import { defineChain } from "viem";

export const WHITECHAIN_SEPOLIA_ID = 1874;
export const EXPLORER_URL = "https://explorer.testnet.whitechain.io";

export const whitechainSepolia = defineChain({
  id: WHITECHAIN_SEPOLIA_ID,
  name: "Whitechain Sepolia",
  nativeCurrency: { name: "WhiteBIT Coin", symbol: "WBT", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://rpc.testnet.whitechain.io"],
      webSocket: ["wss://rpc.testnet.whitechain.io/ws"],
    },
  },
  blockExplorers: {
    default: { name: "Whitechain Sepolia Explorer", url: EXPLORER_URL },
  },
  testnet: true,
});

/** Official test USDT on Whitechain Sepolia (TetherTokenV2 behind an EIP-1967 proxy). */
export const USDT_ADDRESS = "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7" as const;
export const USDT_DECIMALS = 6;

export const explorerTx = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
export const explorerAddress = (address: string) => `${EXPLORER_URL}/address/${address}`;
