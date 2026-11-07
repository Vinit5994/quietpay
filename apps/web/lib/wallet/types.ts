import type { Address, Hex } from "viem";
import type { TypedDataJson } from "./typed-data";

export type WalletStatus = "loading" | "signed_out" | "signed_in";

/**
 * The only wallet surface the app uses. Implementations: the browser demo wallet (now) and Privy (task B4).
 * Pages never talk to a wallet SDK directly.
 */
export interface Wallet {
  status: WalletStatus;
  address: Address | null;
  /** What to show the person, e.g. their email, or "Demo wallet" */
  label: string | null;
  /** Shown on the sign-in button(s) */
  loginOptions: { id: string; label: string }[];
  login(optionId?: string): Promise<void>;
  logout(): Promise<void>;
  /**
   * Sign typed data from the API (uint values as decimal strings).
   * Rejects with SignatureRejectedError when the person closes or declines the request.
   */
  signTypedData(payload: TypedDataJson, purpose: string): Promise<Hex>;
  /** personal_sign a plain-text message (wallet sign-in). Same rejection behaviour as signTypedData. */
  signMessage(message: string, purpose: string): Promise<Hex>;
  /** Send native WBT from the connected wallet; the wallet confirms amount and network fees. */
  sendNative(to: Address, valueWei: bigint): Promise<Hex>;
}

export class SignatureRejectedError extends Error {
  constructor() {
    super("Signature request was closed");
    this.name = "SignatureRejectedError";
  }
}
