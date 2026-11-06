/**
 * Tables from docs/SPEC_API.md "Data model".
 * - Money and wei are TEXT holding a base-unit bigint ("25000000"), never REAL.
 * - Timestamps are INTEGER unix seconds.
 * - Addresses are stored checksummed; compare lowercase via the *_lc columns where we look them up.
 */
import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const merchants = sqliteTable(
  "merchants",
  {
    id: text("id").primaryKey(), // mer_…
    name: text("name").notNull(),
    onchainId: text("onchain_id").notNull(),
    payoutAddress: text("payout_address").notNull(),
    payoutAddressLc: text("payout_address_lc").notNull(),
    signerAddress: text("signer_address").notNull(),
    signerKeyEnc: text("signer_key_enc").notNull(),
    secretKeyHash: text("secret_key_hash").notNull(),
    secretKeyPrefix: text("secret_key_prefix").notNull(),
    webhookUrl: text("webhook_url"),
    webhookSecret: text("webhook_secret").notNull(),
    gasBudgetWei: text("gas_budget_wei").notNull(),
    gasSpentWei: text("gas_spent_wei").notNull().default("0"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("merchants_secret_key_hash").on(t.secretKeyHash),
    uniqueIndex("merchants_onchain_id").on(t.onchainId),
    index("merchants_payout_lc").on(t.payoutAddressLc),
  ],
);

export const checkoutSessions = sqliteTable(
  "checkout_sessions",
  {
    id: text("id").primaryKey(), // sess_…
    merchantId: text("merchant_id").notNull(),
    mode: text("mode", { enum: ["payment", "subscription"] }).notNull(),
    status: text("status", { enum: ["open", "processing", "complete", "expired"] }).notNull(),
    amountUnits: text("amount_units").notNull(),
    lineItemsJson: text("line_items_json").notNull(),
    planId: text("plan_id"),
    reference: text("reference").notNull(),
    customerEmail: text("customer_email"),
    orderIdHex: text("order_id_hex").notNull(),
    invoiceSig: text("invoice_sig"),
    expiresAt: integer("expires_at").notNull(),
    successUrl: text("success_url").notNull(),
    cancelUrl: text("cancel_url").notNull(),
    payerAddress: text("payer_address"),
    paymentId: text("payment_id"),
    subscriptionId: text("subscription_id"),
    txHash: text("tx_hash"),
    paymentLinkId: text("payment_link_id"),
    lastError: text("last_error"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("sessions_merchant").on(t.merchantId),
    uniqueIndex("sessions_order_id").on(t.orderIdHex),
  ],
);

export const paymentLinks = sqliteTable(
  "payment_links",
  {
    id: text("id").primaryKey(), // link_…
    merchantId: text("merchant_id").notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    amountUnits: text("amount_units").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("payment_links_slug").on(t.slug)],
);

export const plans = sqliteTable("plans", {
  id: text("id").primaryKey(), // plan_…
  merchantId: text("merchant_id").notNull(),
  onchainPlanId: text("onchain_plan_id").notNull(),
  name: text("name").notNull(),
  amountUnits: text("amount_units").notNull(),
  interval: text("interval", { enum: ["month", "week", "custom"] }).notNull(),
  periodSeconds: integer("period_seconds").notNull(),
  graceSeconds: integer("grace_seconds").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
});

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: text("id").primaryKey(), // sub_…
    merchantId: text("merchant_id").notNull(),
    onchainSubId: text("onchain_sub_id").notNull(),
    planId: text("plan_id").notNull(),
    subscriberAddress: text("subscriber_address").notNull(),
    customerEmail: text("customer_email"),
    reference: text("reference"),
    status: text("status", { enum: ["active", "past_due", "canceled"] }).notNull(),
    cycle: integer("cycle").notNull().default(0),
    nextChargeAt: integer("next_charge_at"),
    pastDueSince: integer("past_due_since"),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lastAttemptAt: integer("last_attempt_at"),
    cancelReason: text("cancel_reason", { enum: ["customer", "nonpayment", "merchant"] }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("subscriptions_onchain").on(t.onchainSubId)],
);

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(), // pay_ + paymentId hex
    onchainPaymentId: text("onchain_payment_id").notNull(),
    merchantId: text("merchant_id").notNull(),
    kind: text("kind", { enum: ["checkout", "subscription"] }).notNull(),
    sessionId: text("session_id"),
    subscriptionId: text("subscription_id"),
    reference: text("reference"),
    payerAddress: text("payer_address").notNull(),
    amountUnits: text("amount_units").notNull(),
    feeUnits: text("fee_units").notNull().default("0"),
    refundedUnits: text("refunded_units").notNull().default("0"),
    txHash: text("tx_hash").notNull(),
    blockNumber: text("block_number").notNull(),
    paidAt: integer("paid_at").notNull(),
  },
  (t) => [index("payments_merchant").on(t.merchantId)],
);

export const refunds = sqliteTable("refunds", {
  id: text("id").primaryKey(), // re_…
  paymentId: text("payment_id").notNull(),
  amountUnits: text("amount_units").notNull(),
  reason: text("reason"),
  status: text("status", { enum: ["awaiting_signature", "submitted", "succeeded", "failed"] }).notNull(),
  seq: integer("seq"),
  typedDataJson: text("typed_data_json"),
  txHash: text("tx_hash"),
  error: text("error"),
  createdAt: integer("created_at").notNull(),
});

export const chainEvents = sqliteTable("chain_events", {
  id: text("id").primaryKey(), // txHash:logIndex
  name: text("name").notNull(),
  blockNumber: text("block_number").notNull(),
  argsJson: text("args_json").notNull(),
  processedAt: integer("processed_at"),
});

export const indexerCursor = sqliteTable("indexer_cursor", {
  contract: text("contract").primaryKey(),
  lastBlock: text("last_block").notNull(),
});

export const webhookDeliveries = sqliteTable("webhook_deliveries", {
  id: text("id").primaryKey(), // whd_…
  merchantId: text("merchant_id").notNull(),
  eventId: text("event_id").notNull(),
  type: text("type").notNull(),
  url: text("url").notNull(),
  payloadJson: text("payload_json").notNull(),
  status: text("status", { enum: ["pending", "succeeded", "failed"] }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: integer("next_attempt_at"),
  lastStatusCode: integer("last_status_code"),
  lastError: text("last_error"),
  createdAt: integer("created_at").notNull(),
});

export const relayerTxs = sqliteTable("relayer_txs", {
  id: text("id").primaryKey(), // rtx_…
  merchantId: text("merchant_id"),
  purpose: text("purpose", { enum: ["pay", "subscribe", "charge", "refund", "cancel", "admin"] }).notNull(),
  txHash: text("tx_hash"),
  status: text("status", { enum: ["pending", "succeeded", "failed"] }).notNull(),
  gasUsed: text("gas_used"),
  gasCostWei: text("gas_cost_wei"),
  error: text("error"),
  createdAt: integer("created_at").notNull(),
});

export const authNonces = sqliteTable("auth_nonces", {
  address: text("address").primaryKey(), // lowercase
  nonce: text("nonce").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
