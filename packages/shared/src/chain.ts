import { defineChain, getAddress, type Address, type Hash } from "viem";

export const WHITECHAIN_SEPOLIA_CHAIN_ID = 1874;
export const WHITECHAIN_SEPOLIA_RPC_URL = "https://rpc.testnet.whitechain.io";
export const WHITECHAIN_SEPOLIA_WS_URL = "wss://rpc.testnet.whitechain.io/ws";
export const EXPLORER_URL = "https://explorer.testnet.whitechain.io";

export const whitechainSepolia = defineChain({
  id: WHITECHAIN_SEPOLIA_CHAIN_ID,
  name: "Whitechain Sepolia",
  nativeCurrency: { name: "WhiteBIT Coin", symbol: "WBT", decimals: 18 },
  rpcUrls: {
    default: { http: [WHITECHAIN_SEPOLIA_RPC_URL], webSocket: [WHITECHAIN_SEPOLIA_WS_URL] },
  },
  blockExplorers: {
    default: { name: "Whitechain Explorer", url: EXPLORER_URL },
  },
  testnet: true,
});

/** Official test USDT proxy (TetherTokenV2 implementation). */
export const USDT_ADDRESS: Address = getAddress("0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7");
export const USDT_DECIMALS = 6;
/** On-chain `DOMAIN_SEPARATOR()` of USDT; `eip712.test.ts` asserts we compute the same value. */
export const USDT_DOMAIN_SEPARATOR: Hash = "0xcdcfacb6b15c8238b4e5fbb47bdb83b7f83f50a531d264bf9763d2bd1d3d2a25";

export function explorerTx(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}

export function explorerAddress(address: string): string {
  return `${EXPLORER_URL}/address/${address}`;
}
