import { Hono } from "hono";

export const app = new Hono();

app.get("/", (c) => c.json({ name: "quietpay-api", ok: true }));
