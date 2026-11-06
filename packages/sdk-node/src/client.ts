import type {
  BodyOf,
  CheckoutSession,
  CreatedPaymentLink,
  CreatedRefund,
  ListPaymentsParams,
  ListSubscriptionsParams,
  Payment,
  PaymentLink,
  Plan,
  ResponseOf,
  Subscription,
  WebhookDelivery,
} from "@quietpay/shared/api-types";
import { QuietPayError } from "./errors";
import { verifyWebhook, type QuietPayEvent, type VerifyOptions } from "./webhooks";

export type QuietPayOptions = {
  /** Default: `process.env.QUIETPAY_API_URL ?? "http://localhost:4000"` */
  baseUrl?: string;
  /** Custom fetch (tests, proxies). Default: global fetch. */
  fetch?: typeof fetch;
  /** Request timeout in ms (default 15000). */
  timeoutMs?: number;
};

export type List<T> = { data: T[]; nextCursor: string | null };
type Query = Record<string, string | number | undefined>;

export class QuietPay {
  readonly baseUrl: string;
  readonly #secretKey: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(secretKey: string, options: QuietPayOptions = {}) {
    if (!secretKey) throw new QuietPayError("missing_secret_key", "QuietPay secret key is required (sk_test_…)");
    this.#secretKey = secretKey;
    this.baseUrl = (options.baseUrl ?? process.env.QUIETPAY_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? 15_000;
  }

  readonly checkout = {
    sessions: {
      create: (params: BodyOf<"createCheckoutSession">): Promise<CheckoutSession> =>
        this.#request("POST", "/v1/checkout/sessions", { body: params }),
      retrieve: (id: string): Promise<CheckoutSession> =>
        this.#request("GET", `/v1/checkout/sessions/${encodeURIComponent(id)}`),
    },
  };

  readonly paymentLinks = {
    create: (params: BodyOf<"createPaymentLink">): Promise<CreatedPaymentLink> =>
      this.#request("POST", "/v1/payment_links", { body: params }),
    list: (query: { limit?: number; cursor?: string } = {}): Promise<List<PaymentLink>> =>
      this.#request("GET", "/v1/payment_links", { query }),
  };

  readonly plans = {
    create: (params: BodyOf<"createPlan">): Promise<Plan> => this.#request("POST", "/v1/plans", { body: params }),
    list: (query: { limit?: number; cursor?: string } = {}): Promise<List<Plan>> =>
      this.#request("GET", "/v1/plans", { query }),
  };

  readonly payments = {
    list: (query: ListPaymentsParams = {}): Promise<List<Payment>> =>
      this.#request("GET", "/v1/payments", { query }),
  };

  readonly subscriptions = {
    list: (query: ListSubscriptionsParams = {}): Promise<List<Subscription>> =>
      this.#request("GET", "/v1/subscriptions", { query }),
    cancel: (id: string): Promise<Subscription> =>
      this.#request("POST", `/v1/subscriptions/${encodeURIComponent(id)}/cancel`),
  };

  readonly refunds = {
    create: (params: BodyOf<"createRefund">): Promise<CreatedRefund> =>
      this.#request("POST", "/v1/refunds", { body: params }),
  };

  readonly exports = {
    /** CSV text: date,payment_id,kind,reference,payer,amount,fee,refunded,net,tx_hash,explorer_url */
    paymentsCsv: (): Promise<string> => this.#request("GET", "/v1/exports/payments.csv", { text: true }),
  };

  readonly webhookEndpoint = {
    /** Sets the webhook URL. Returns the new signing secret (shown once). */
    update: (params: BodyOf<"updateWebhookEndpoint">): Promise<ResponseOf<"updateWebhookEndpoint">> =>
      this.#request("PUT", "/v1/webhook_endpoint", { body: params }),
    /** Sends a `ping` event to the configured URL. */
    test: (): Promise<WebhookDelivery> => this.#request("POST", "/v1/webhook_endpoint/test"),
  };

  readonly webhooks = {
    /** Verifies the `QuietPay-Signature` header and returns the event. Throws on a bad or old signature. */
    verify: (rawBody: string, signatureHeader: string | null | undefined, secret: string, options?: VerifyOptions): QuietPayEvent =>
      verifyWebhook(rawBody, signatureHeader, secret, options),
  };

  async #request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; query?: Query; text?: boolean } = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

    let res: Response;
    try {
      res = await this.#fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${this.#secretKey}`,
          accept: opts.text ? "text/csv" : "application/json",
          ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (err) {
      throw new QuietPayError("network_error", `Could not reach QuietPay at ${this.baseUrl}: ${(err as Error).message}`);
    }

    const raw = await res.text();
    if (!res.ok) {
      let code = "api_error";
      let message = `QuietPay API returned HTTP ${res.status}`;
      try {
        const parsed = JSON.parse(raw) as { error?: { code?: string; message?: string } };
        if (parsed.error?.code) code = parsed.error.code;
        if (parsed.error?.message) message = parsed.error.message;
      } catch {
        // not JSON; keep the generic message
      }
      throw new QuietPayError(code, message, res.status);
    }
    if (opts.text) return raw as T;
    return (raw ? JSON.parse(raw) : undefined) as T;
  }
}
