import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import type { Address } from "viem";
import { z } from "zod";
import { Endpoints, toUnits, type EndpointDef, type EndpointName } from "@quietpay/shared";
import { chargeSubscription } from "./engine";
import { handlers, MockError, type Caller } from "./handlers";
import { SEEDED, getBalance, setBalance, toCheckoutSession, type MockState } from "./state";

const errorBody = (code: string, message: string) => ({ error: { code, message } });

function bearer(c: Context): string | null {
  const h = c.req.header("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

/**
 * Mock tokens: secret key `sk_test_…`, or `mock.<role>.<address>` from /auth/verify. `mock.merchant.demo` = seeded merchant.
 * "secret" endpoints accept a secret key OR a merchant token (the dashboard reuses /v1), like the real API.
 */
function resolveCaller(state: MockState, auth: EndpointDef["auth"], token: string | null): Caller {
  if (auth === "none") return {};
  if (!token) throw new MockError("unauthorized", "Sign in first.", 401);
  if (auth === "secret" && token.startsWith("sk_")) {
    const merchant = state.merchants.find((m) => m.secretKey === token);
    if (!merchant) throw new MockError("unauthorized", "Invalid secret key.", 401);
    return { merchant };
  }
  const want = auth === "secret" ? "merchant" : auth;
  const [prefix, role, address] = token.split(".");
  if (prefix !== "mock" || role !== want || !address) throw new MockError("unauthorized", "Your session has expired. Sign in again.", 401);
  if (want === "merchant") {
    if (address === "demo") return { merchant: state.merchants.find((m) => m.id === SEEDED.merchantId)!, address: SEEDED.payoutAddress };
    const merchant = state.merchants.find((m) => m.payoutAddress.toLowerCase() === address.toLowerCase());
    return { merchant, address: address as Address };
  }
  return { address: address as Address };
}

function zodMessage(err: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const issue = err.issues[0];
  return issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid request";
}

export function createApp(state: MockState) {
  const app = new Hono();
  app.use("*", cors({ origin: (origin) => origin ?? "*", allowHeaders: ["content-type", "authorization"], allowMethods: ["GET", "POST", "PUT", "OPTIONS"] }));

  app.onError((err, c) => {
    if (err instanceof MockError) return c.json(errorBody(err.code, err.message), err.status);
    console.error("[mock] unexpected error", err);
    return c.json(errorBody("internal_error", "Mock API error: " + (err as Error).message), 500);
  });

  // Every endpoint from the shared map, with the same validation the real API will do.
  for (const [key, def] of Object.entries(Endpoints) as [EndpointName, EndpointDef][]) {
    app.on(def.method, def.path, async (c) => {
      const caller = resolveCaller(state, def.auth, bearer(c));

      if (def.params) {
        const parsed = def.params.safeParse(c.req.param());
        if (!parsed.success) throw new MockError("validation_failed", zodMessage(parsed.error), 400);
      }
      let query: unknown;
      if (def.query) {
        const parsed = def.query.safeParse(c.req.query());
        if (!parsed.success) throw new MockError("validation_failed", zodMessage(parsed.error), 400);
        query = parsed.data;
      }
      let body: unknown;
      if (def.body) {
        const raw = await c.req.json().catch(() => ({}));
        const parsed = def.body.safeParse(raw);
        if (!parsed.success) throw new MockError("validation_failed", zodMessage(parsed.error), 400);
        body = parsed.data;
      }

      const handler = handlers[key] as (ctx: unknown) => unknown;
      const result = await handler({ c, state, params: c.req.param(), body, query, caller });

      if (def.response === "csv") {
        return c.body(result as string, 200, {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="payments.csv"',
        });
      }
      // Catch drift between the mock and the shared contract immediately.
      const checked = def.response.safeParse(result);
      if (!checked.success) {
        console.error(`[mock] ${key} returned data that doesn't match the shared schema`, checked.error.issues);
        throw new MockError("internal_error", `Mock response for ${key} failed schema validation`, 500);
      }
      return c.json(checked.data, (def.status ?? 200) as 200);
    });
  }

  // ── Mock-only controls (not part of the real API) ────────────────────────
  app.get("/mock/state", (c) =>
    c.json({
      sessions: [...state.sessions.values()].map((s) => toCheckoutSession(state, s)),
      subscriptions: state.subs.map((s) => ({ id: s.id, status: s.status, cycle: s.cycle, forceFail: s.forceFail })),
      deliveries: state.deliveries.slice(0, 20).map((d) => ({ type: d.type, status: d.status, attempts: d.attempts, lastError: d.lastError })),
    }),
  );
  app.post("/mock/set-balance", async (c) => {
    const { address, amount } = z.object({ address: z.string(), amount: z.string() }).parse(await c.req.json());
    setBalance(state, address, toUnits(amount));
    return c.json({ address, balance: amount });
  });
  app.get("/mock/balance/:address", (c) => c.json({ address: c.req.param("address"), units: getBalance(state, c.req.param("address")).toString() }));
  app.post("/mock/fail-next-renewal/:subId", (c) => {
    const sub = state.subs.find((s) => s.id === c.req.param("subId"));
    if (!sub) throw new MockError("not_found", "Subscription not found.", 404);
    sub.forceFail = true;
    return c.json({ id: sub.id, forceFail: true, note: "Renewals fail until POST /mock/recover/:subId (past due, then canceled after grace)." });
  });
  app.post("/mock/recover/:subId", (c) => {
    const sub = state.subs.find((s) => s.id === c.req.param("subId"));
    if (!sub) throw new MockError("not_found", "Subscription not found.", 404);
    sub.forceFail = false;
    return c.json({ id: sub.id, forceFail: false });
  });
  app.post("/mock/charge-now/:subId", async (c) => {
    const sub = state.subs.find((s) => s.id === c.req.param("subId"));
    if (!sub) throw new MockError("not_found", "Subscription not found.", 404);
    await chargeSubscription(state, sub);
    return c.json({ id: sub.id, status: sub.status, cycle: sub.cycle });
  });

  return app;
}
