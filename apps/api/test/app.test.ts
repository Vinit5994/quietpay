import { describe, expect, it } from "vitest";
import { app } from "../src/app";

describe("app", () => {
  it("serves hello-world", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "quietpay-api", ok: true });
  });
});
