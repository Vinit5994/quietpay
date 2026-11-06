import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";
import type { ErrorCode } from "@quietpay/shared";

/** Thrown anywhere in a handler; rendered as `{ error: { code, message } }`. */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new ApiError(400, "bad_request", message);
export const unauthorized = (message = "Missing or invalid credentials.") => new ApiError(401, "unauthorized", message);
export const notFound = (what: string) => new ApiError(404, "not_found", `${what} not found.`);

export function onError(err: Error, c: Context) {
  if (err instanceof ApiError) {
    return c.json({ error: { code: err.code, message: err.message } }, err.status);
  }
  if (err instanceof ZodError) {
    const message = err.issues
      .slice(0, 5)
      .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
      .join("; ");
    return c.json({ error: { code: "validation_failed", message } }, 400);
  }
  if (err instanceof SyntaxError) {
    return c.json({ error: { code: "bad_request", message: "Request body is not valid JSON." } }, 400);
  }
  console.error("[api] unhandled error", err);
  return c.json({ error: { code: "internal_error", message: "Something went wrong on our side." } }, 500);
}
