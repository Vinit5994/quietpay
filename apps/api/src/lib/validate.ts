import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";
import { Endpoints, type BodyOf, type EndpointName, type ResponseOf } from "@quietpay/shared";

type Schemaful<N extends EndpointName, K extends "body" | "query" | "params"> = Endpoints[N] extends {
  [P in K]: infer S extends z.ZodType;
}
  ? z.output<S>
  : never;

/** Parses the JSON body with the endpoint's shared zod schema (throws ZodError → 400). */
export async function readBody<N extends EndpointName>(c: Context, name: N): Promise<Schemaful<N, "body">> {
  const schema = (Endpoints[name] as { body?: z.ZodType }).body;
  if (!schema) throw new Error(`${name} has no body schema`);
  const json: unknown = await c.req.json();
  return schema.parse(json) as Schemaful<N, "body">;
}

export function readQuery<N extends EndpointName>(c: Context, name: N): Schemaful<N, "query"> {
  const schema = (Endpoints[name] as { query?: z.ZodType }).query;
  if (!schema) throw new Error(`${name} has no query schema`);
  return schema.parse(c.req.query()) as Schemaful<N, "query">;
}

/**
 * Validates the response against the shared schema before sending, so the real API cannot drift
 * from what the frontend was built against. A mismatch is our bug: log it and return 500.
 */
export function send<N extends EndpointName>(c: Context, name: N, data: ResponseOf<N>) {
  const def = Endpoints[name];
  const schema = def.response as z.ZodType;
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    console.error(`[api] response for ${name} does not match api-types.ts`, parsed.error.issues);
    throw new Error(`Response for ${name} failed schema validation`);
  }
  const status = ("status" in def ? def.status : 200) as ContentfulStatusCode;
  return c.json(parsed.data as object, status);
}

export type { BodyOf };
