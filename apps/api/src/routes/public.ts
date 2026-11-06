import { Hono, type Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { AppEnv, Deps } from "../deps";
import type { Relayer } from "../relayer";
import { readBody, send } from "../lib/validate";
import { loadSession, prepareSession, toPublicSession } from "../services/sessions";
import { sessionStatus, submitPayment } from "../services/submit";

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

  return app;
}
