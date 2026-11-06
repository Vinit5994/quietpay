import { Hono } from "hono";
import type { AppEnv, Deps } from "../deps";
import { readBody, send } from "../lib/validate";
import { loadSession, prepareSession, toPublicSession } from "../services/sessions";

/** Checkout page API. No auth: the unguessable session id is the capability. */
export function publicRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.get("/sessions/:id", (c) => {
    const { row, merchant } = loadSession(deps, c.req.param("id"));
    return send(c, "publicGetSession", toPublicSession(deps, row, merchant));
  });

  app.post("/sessions/:id/prepare", async (c) => {
    const { payer } = await readBody(c, "publicPrepareSession");
    return send(c, "publicPrepareSession", await prepareSession(deps, c.req.param("id"), payer));
  });

  return app;
}
