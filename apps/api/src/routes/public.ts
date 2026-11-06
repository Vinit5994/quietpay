import { Hono, type Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { AppEnv, Deps } from "../deps";
import type { Relayer } from "../relayer";
import { readBody, send } from "../lib/validate";
import { loadSession, prepareSession, toPublicSession } from "../services/sessions";
import { sessionStatus, submitPayment } from "../services/submit";
import { requireJwt } from "../auth";
import { loadCustomerSubscription, prepareCustomerCancel, submitCustomerCancel } from "../services/subscriptions";
import type { Hex } from "viem";
import { openPaymentLink } from "../services/links";
import { portal, receipt } from "../services/receipts";

function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown"; // app.request() in tests has no socket
  }
}

/** Checkout page API. No auth: the unguessable session id is the capability. */
export function publicRoutes(deps: Deps, relayer: Relayer) {
  const app = new Hono<AppEnv>();

  app.get("/sessions/:id", (c) => {
    const { row, merchant } = loadSession(deps, c.req.param("id"));
    return send(c, "publicGetSession", toPublicSession(deps, row, merchant));
  });

  app.post("/sessions/:id/prepare", async (c) => {
    const { payer } = await readBody(c, "publicPrepareSession");
    return send(c, "publicPrepareSession", await prepareSession(deps, c.req.param("id"), payer));
  });

  app.post("/sessions/:id/submit", async (c) => {
    const body = await readBody(c, "publicSubmitSession");
    return send(c, "publicSubmitSession", await submitPayment(deps, relayer, c.req.param("id"), body, clientIp(c)));
  });

  app.get("/sessions/:id/status", (c) => send(c, "publicSessionStatus", sessionStatus(deps, c.req.param("id"))));

  // ---- payment links and receipts (public)
  app.get("/links/:slug", async (c) => send(c, "publicLink", await openPaymentLink(deps, c.req.param("slug"))));
  app.get("/receipts/:paymentId", (c) => send(c, "publicReceipt", receipt(deps, c.req.param("paymentId"))));

  // ---- customer portal (customer JWT): own subscriptions + payments; cancel with a signature (gasless)
  app.use("/portal", requireJwt(deps, "customer"));
  app.use("/portal/*", requireJwt(deps, "customer"));
  app.get("/portal", (c) => send(c, "publicPortal", portal(deps, c.get("jwt").sub)));

  app.post("/portal/subscriptions/:id/cancel/prepare", async (c) => {
    const sub = loadCustomerSubscription(deps, c.get("jwt").sub, c.req.param("id"));
    return send(c, "publicPortalCancelPrepare", await prepareCustomerCancel(deps, sub));
  });

  app.post("/portal/subscriptions/:id/cancel/submit", async (c) => {
    const { signature } = await readBody(c, "publicPortalCancelSubmit");
    const sub = loadCustomerSubscription(deps, c.get("jwt").sub, c.req.param("id"));
    return send(c, "publicPortalCancelSubmit", await submitCustomerCancel(deps, relayer, sub, signature as Hex));
  });

  return app;
}
