"use client";

import { useApi } from "../use-api";
import { useWallet } from "../wallet";
import { loadAdminAccess } from "./chain";

export function useAdminAccess() {
  const wallet = useWallet();
  const address = wallet.status === "signed_in" ? wallet.address : null;
  const result = useApi(() => loadAdminAccess(address), [address], { pollMs: 30_000 });
  const current = result.data?.address?.toLowerCase() === address?.toLowerCase();
  return {
    allowed: current && result.data?.allowed === true,
    loading: Boolean(address) && (result.loading || (!current && !result.error)),
    error: result.error,
    reload: result.reload,
  };
}
