import "server-only";
import { QuietPay } from "@quietpay/node";

/** The store's QuietPay client. Server-side only: the secret key never reaches the browser. */
export const qp = new QuietPay(process.env.QUIETPAY_SECRET_KEY!);

export const STORE_URL = process.env.STORE_URL ?? "http://localhost:3000";
