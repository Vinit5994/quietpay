"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import type { Hex } from "viem";
import { ApiError, api } from "@/lib/api";
import { SignatureRejectedError, useWallet } from "@/lib/wallet";
import { initialPhase, reducer, signSteps } from "./machine";

const POLL_MS = 1_000;
const SLOW_AFTER_MS = 15_000;

function errorOf(err: unknown): { code: string; message: string } {
  if (err instanceof ApiError) return { code: err.code, message: err.message };
  return { code: "internal_error", message: "Something went wrong. Please try again." };
}

/** Runs the checkout: loads the session, signs in, prepares, signs, submits and polls. */
export function useCheckout(sessionId: string) {
  const wallet = useWallet();
  const [phase, dispatch] = useReducer(reducer, initialPhase);
  const busyRef = useRef(false);

  // Load the session once the wallet knows whether someone is signed in.
  const walletReady = wallet.status !== "loading";
  useEffect(() => {
    if (!walletReady) return;
    const ctrl = new AbortController();
    api("getPublicSession", { params: { id: sessionId }, signal: ctrl.signal })
      .then((session) => dispatch({ type: "loaded", session, signedIn: wallet.status === "signed_in" }))
      .catch((err) => {
        if ((err as Error).name !== "AbortError") dispatch({ type: "load_failed", ...errorOf(err) });
      });
    return () => ctrl.abort();
    // Only on first readiness; sign-in changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, walletReady]);

  // Keep the phase in sync with sign-in / sign-out.
  useEffect(() => {
    if (wallet.status === "signed_in") dispatch({ type: "signed_in" });
    if (wallet.status === "signed_out") dispatch({ type: "signed_out" });
  }, [wallet.status]);

  // Expire on the client when the session's time runs out.
  const expiresAt = phase.name !== "loading" && phase.session ? phase.session.expiresAt : null;
  useEffect(() => {
    if (!expiresAt) return;
    const ms = new Date(expiresAt).getTime() - Date.now();
    const t = setTimeout(() => dispatch({ type: "expired_locally" }), Math.max(0, ms));
    return () => clearTimeout(t);
  }, [expiresAt]);

  // Poll while the payment confirms.
  const processing = phase.name === "processing";
  useEffect(() => {
    if (!processing) return;
    const slow = setTimeout(() => dispatch({ type: "slow" }), SLOW_AFTER_MS);
    const poll = setInterval(() => {
      api("getSessionStatus", { params: { id: sessionId } })
        .then((status) => dispatch({ type: "status", status }))
        .catch(() => {
          /* transient: keep polling */
        });
    }, POLL_MS);
    return () => {
      clearTimeout(slow);
      clearInterval(poll);
    };
  }, [processing, sessionId]);

  const pay = useCallback(async () => {
    if (busyRef.current || !wallet.address) return;
    busyRef.current = true;
    const payer = wallet.address;
    try {
      dispatch({ type: "pay_started" });
      const prepare = await api("prepareSession", { params: { id: sessionId }, body: { payer } });
      dispatch({ type: "prepared", prepare });
      if (!prepare.sufficientFunds) return;

      const steps = signSteps(prepare);
      const signatures: Partial<Record<"payment" | "subscribe" | "permit", Hex>> = {};
      for (const [i, step] of steps.entries()) {
        dispatch({ type: "sign_step", current: i + 1, total: steps.length, label: step.label });
        try {
          signatures[step.key] = await wallet.signTypedData(step.payload, step.label);
        } catch (err) {
          if (err instanceof SignatureRejectedError) {
            dispatch({ type: "sign_rejected" });
            return;
          }
          throw err;
        }
      }

      dispatch({ type: "submit_started" });
      const { txHash } = await api("submitSession", { params: { id: sessionId }, body: { payer, signatures } });
      dispatch({ type: "submitted", txHash });
    } catch (err) {
      dispatch({ type: "failed", ...errorOf(err) });
    } finally {
      busyRef.current = false;
    }
  }, [sessionId, wallet]);

  return { phase, wallet, pay };
}
