import { Endpoints, ErrorEnvelope, type BodyOf, type EndpointDef, type EndpointName, type QueryOf, type ResponseOf } from "@quietpay/shared";
import { env } from "./env";

/** Error from the QuietPay API (or the network), with a message safe to show to people. */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type CallOptions<N extends EndpointName> = {
  params?: Record<string, string>;
  /** Merchant or customer JWT, for "merchant" / "customer" endpoints (and "secret" ones from the dashboard) */
  token?: string;
  signal?: AbortSignal;
} & ([BodyOf<N>] extends [never] ? { body?: undefined } : { body: BodyOf<N> }) &
  ([QueryOf<N>] extends [never] ? { query?: undefined } : { query?: QueryOf<N> });

function buildPath(path: string, params: Record<string, string> = {}): string {
  return path.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`Missing path param "${name}" for ${path}`);
    return encodeURIComponent(value);
  });
}

/**
 * Typed call to a QuietPay endpoint. Request bodies and responses are validated with the shared
 * zod schemas, so a mismatch between frontend and API fails loudly instead of rendering bad data.
 */
export async function api<N extends EndpointName>(name: N, options: CallOptions<N>): Promise<ResponseOf<N>> {
  const def = Endpoints[name] as EndpointDef;
  const url = new URL(buildPath(def.path, options.params), env.apiUrl);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query as Record<string, unknown>)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const body = def.body ? JSON.stringify(def.body.parse(options.body ?? {})) : undefined;

  let res: Response;
  try {
    res = await fetch(url, {
      method: def.method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      body,
      signal: options.signal,
      cache: "no-store",
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError("network_error", "Can't reach QuietPay right now. Check your connection and try again.", 0);
  }

  if (!res.ok) {
    const parsed = ErrorEnvelope.safeParse(await res.json().catch(() => null));
    if (parsed.success) throw new ApiError(parsed.data.error.code, parsed.data.error.message, res.status);
    throw new ApiError("internal_error", "Something went wrong on our side. Please try again.", res.status);
  }

  if (def.response === "csv") return (await res.text()) as ResponseOf<N>;

  const parsed = def.response.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    console.error(`[api] ${name}: response did not match the shared schema`, parsed.error.issues);
    throw new ApiError("bad_response", "QuietPay sent an unexpected response. Please try again.", res.status);
  }
  return parsed.data as ResponseOf<N>;
}
