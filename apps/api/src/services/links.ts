import { and, desc, eq } from "drizzle-orm";
import QRCode from "qrcode";
import { fromUnits, toUnits, type BodyOf, type PaymentLink } from "@quietpay/shared";
import { merchants, paymentLinks } from "../db/schema";
import type { Deps, MerchantRow } from "../deps";
import { ApiError, notFound } from "../lib/errors";
import { isoFromSeconds, newId, nowSeconds } from "../lib/ids";
import { MIN_AMOUNT_UNITS, createCheckoutSession, sessionUrl } from "./sessions";

export type LinkRow = typeof paymentLinks.$inferSelect;

const webUrl = (deps: Deps) => deps.env.PUBLIC_WEB_URL.replace(/\/$/, "");
export const linkUrl = (deps: Deps, slug: string) => `${webUrl(deps)}/l/${slug}`;

export function toPaymentLink(deps: Deps, row: LinkRow): PaymentLink {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    amount: fromUnits(BigInt(row.amountUnits)),
    active: row.active,
    url: linkUrl(deps, row.slug),
    createdAt: isoFromSeconds(row.createdAt),
  };
}

/** "Sticker Pack!" → "sticker-pack"; adds -2, -3… if taken. `slug` lets the seed pick a fixed one. */
function uniqueSlug(deps: Deps, title: string, wanted?: string) {
  const base =
    (wanted ?? title)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "link";
  for (let n = 1; n < 1000; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (!deps.db.select().from(paymentLinks).where(eq(paymentLinks.slug, slug)).get()) return slug;
  }
  return `${base}-${newId("x").slice(2, 8).toLowerCase()}`;
}

export async function qrSvg(url: string) {
  return QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
}

export async function createPaymentLink(deps: Deps, merchant: MerchantRow, body: BodyOf<"createPaymentLink">, opts: { slug?: string } = {}) {
  const amount = toUnits(body.amount);
  if (amount < MIN_AMOUNT_UNITS) {
    throw new ApiError(422, "amount_below_minimum", `Minimum is ${fromUnits(MIN_AMOUNT_UNITS)} USDT.`);
  }
  const row: LinkRow = {
    id: newId("link"),
    merchantId: merchant.id,
    slug: uniqueSlug(deps, body.title, opts.slug),
    title: body.title,
    description: body.description ?? null,
    amountUnits: amount.toString(),
    active: true,
    createdAt: nowSeconds(),
  };
  deps.db.insert(paymentLinks).values(row).run();
  const link = toPaymentLink(deps, row);
  return { ...link, qrSvg: await qrSvg(link.url) };
}

export function listPaymentLinks(deps: Deps, merchantId: string) {
  return deps.db.select().from(paymentLinks).where(eq(paymentLinks.merchantId, merchantId)).orderBy(desc(paymentLinks.createdAt)).all();
}

/** GET /public/links/:slug: every visit gets a fresh payment session (so one QR can be paid many times). */
export async function openPaymentLink(deps: Deps, slug: string) {
  const link = deps.db.select().from(paymentLinks).where(and(eq(paymentLinks.slug, slug), eq(paymentLinks.active, true))).get();
  if (!link) throw notFound("Payment link");
  const merchant = deps.db.select().from(merchants).where(eq(merchants.id, link.merchantId)).get();
  if (!merchant) throw notFound("Merchant");

  const amount = fromUnits(BigInt(link.amountUnits));
  const home = `${webUrl(deps)}/`;
  const session = await createCheckoutSession(
    deps,
    merchant,
    {
      mode: "payment",
      reference: `link:${link.slug}`,
      lineItems: [{ name: link.title, unitAmount: amount, quantity: 1 }],
      successUrl: home,
      cancelUrl: home,
    },
    { paymentLinkId: link.id },
  );
  return { sessionId: session.id, sessionUrl: sessionUrl(deps, session.id), title: link.title, amount };
}
