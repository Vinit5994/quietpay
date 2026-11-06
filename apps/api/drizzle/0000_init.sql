CREATE TABLE `auth_nonces` (
	`address` text PRIMARY KEY NOT NULL,
	`nonce` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chain_events` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`block_number` text NOT NULL,
	`args_json` text NOT NULL,
	`processed_at` integer
);
--> statement-breakpoint
CREATE TABLE `checkout_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`amount_units` text NOT NULL,
	`line_items_json` text NOT NULL,
	`plan_id` text,
	`reference` text NOT NULL,
	`customer_email` text,
	`order_id_hex` text NOT NULL,
	`invoice_sig` text,
	`expires_at` integer NOT NULL,
	`success_url` text NOT NULL,
	`cancel_url` text NOT NULL,
	`payer_address` text,
	`payment_id` text,
	`subscription_id` text,
	`tx_hash` text,
	`payment_link_id` text,
	`last_error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_merchant` ON `checkout_sessions` (`merchant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_order_id` ON `checkout_sessions` (`order_id_hex`);--> statement-breakpoint
CREATE TABLE `indexer_cursor` (
	`contract` text PRIMARY KEY NOT NULL,
	`last_block` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `merchants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`onchain_id` text NOT NULL,
	`payout_address` text NOT NULL,
	`payout_address_lc` text NOT NULL,
	`signer_address` text NOT NULL,
	`signer_key_enc` text NOT NULL,
	`secret_key_hash` text NOT NULL,
	`secret_key_prefix` text NOT NULL,
	`webhook_url` text,
	`webhook_secret` text NOT NULL,
	`gas_budget_wei` text NOT NULL,
	`gas_spent_wei` text DEFAULT '0' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchants_secret_key_hash` ON `merchants` (`secret_key_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `merchants_onchain_id` ON `merchants` (`onchain_id`);--> statement-breakpoint
CREATE INDEX `merchants_payout_lc` ON `merchants` (`payout_address_lc`);--> statement-breakpoint
CREATE TABLE `payment_links` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`amount_units` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_links_slug` ON `payment_links` (`slug`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`onchain_payment_id` text NOT NULL,
	`merchant_id` text NOT NULL,
	`kind` text NOT NULL,
	`session_id` text,
	`subscription_id` text,
	`reference` text,
	`payer_address` text NOT NULL,
	`amount_units` text NOT NULL,
	`fee_units` text DEFAULT '0' NOT NULL,
	`refunded_units` text DEFAULT '0' NOT NULL,
	`tx_hash` text NOT NULL,
	`block_number` text NOT NULL,
	`paid_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `payments_merchant` ON `payments` (`merchant_id`);--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`onchain_plan_id` text NOT NULL,
	`name` text NOT NULL,
	`amount_units` text NOT NULL,
	`interval` text NOT NULL,
	`period_seconds` integer NOT NULL,
	`grace_seconds` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`amount_units` text NOT NULL,
	`reason` text,
	`status` text NOT NULL,
	`seq` integer,
	`typed_data_json` text,
	`tx_hash` text,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `relayer_txs` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text,
	`purpose` text NOT NULL,
	`tx_hash` text,
	`status` text NOT NULL,
	`gas_used` text,
	`gas_cost_wei` text,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`onchain_sub_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`subscriber_address` text NOT NULL,
	`customer_email` text,
	`reference` text,
	`status` text NOT NULL,
	`cycle` integer DEFAULT 0 NOT NULL,
	`next_charge_at` integer,
	`past_due_since` integer,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` integer,
	`cancel_reason` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_onchain` ON `subscriptions` (`onchain_sub_id`);--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`event_id` text NOT NULL,
	`type` text NOT NULL,
	`url` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`last_status_code` integer,
	`last_error` text,
	`created_at` integer NOT NULL
);
