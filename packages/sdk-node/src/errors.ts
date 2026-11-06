/** Thrown for any non-2xx API response, network failure, or bad webhook signature. */
export class QuietPayError extends Error {
  override readonly name = "QuietPayError";

  constructor(
    /** API error code, e.g. "session_expired", or "network_error" / "invalid_webhook_signature" */
    readonly code: string,
    message: string,
    /** HTTP status, 0 when the request never got a response */
    readonly status = 0,
  ) {
    super(message);
  }
}
