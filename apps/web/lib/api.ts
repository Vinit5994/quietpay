import {
  ApiErrorBody,
  endpoints,
  type BodyOf,
  type EndpointKey,
  type QueryOf,
  type ResponseOf,
} from "@quietpay/shared";
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

type CallOptions<K extends EndpointKey> = {
  params?: Record<string, string>;
  /** Merchant or customer JWT, for "merchant" / "customer" endpoints */
  token?: string;
  signal?: AbortSignal;
} & ([BodyOf<K>] extends [never] ? { body?: undefined } : { body: BodyOf<K> }) &
  ([QueryOf<K>] extends [never] ? { query?: undefined } : { query?: QueryOf<K> });

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
export async function api<K extends EndpointKey>(key: K, options: CallOptions<K>): Promise<ResponseOf<K>> {
  const def = endpoints[key];
  const url = new URL(buildPath(def.path, options.params), env.apiUrl);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query as Record<string, unknown>)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  let body: string | undefined;
  if ("body" in def && def.body) {
    body = JSON.stringify(def.body.parse(options.body ?? {}));
  }

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

  const isCsv = "responseType" in def && def.responseType === "csv";
  const payload: unknown = isCsv ? await res.text() : await res.json().catch(() => null);

  if (!res.ok) {
    const parsed = ApiErrorBody.safeParse(payload);
    if (parsed.success) throw new ApiError(parsed.data.error.code, parsed.data.error.message, res.status);
    throw new ApiError("internal_error", "Something went wrong on our side. Please try again.", res.status);
  }

  const parsed = def.response.safeParse(payload);
  if (!parsed.success) {
    console.error(`[api] ${key}: response did not match the shared schema`, parsed.error.issues);
    throw new ApiError("bad_response", "QuietPay sent an unexpected response. Please try again.", res.status);
  }
  return parsed.data as ResponseOf<K>;
}
