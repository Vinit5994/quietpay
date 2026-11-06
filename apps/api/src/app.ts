import { Hono } from "hono";
import { cors } from "hono/cors";
import { authRoutes } from "./auth";
import type { AppEnv, Deps } from "./deps";
import { onError } from "./lib/errors";
import { publicRoutes } from "./routes/public";
import { v1Routes } from "./routes/v1";

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();

  // The web app (checkout, dashboard, portal) calls us from the browser.
  app.use(
    "*",
    cors({
      origin: (origin) => (origin === deps.env.PUBLIC_WEB_URL || /^http:\/\/localhost:\d+$/.test(origin) ? origin : null),
      allowHeaders: ["authorization", "content-type"],
      allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
    }),
  );

  app.get("/", (c) => c.json({ name: "quietpay-api", ok: true }));
  app.route("/auth", authRoutes(deps));
  app.route("/v1", v1Routes(deps));
  app.route("/public", publicRoutes(deps));

  app.notFound((c) => c.json({ error: { code: "not_found", message: `No route ${c.req.method} ${c.req.path}.` } }, 404));
  app.onError(onError);
  return app;
}
