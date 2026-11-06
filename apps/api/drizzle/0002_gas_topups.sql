CREATE TABLE `gas_topups` (
	`tx_hash` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`value_wei` text NOT NULL,
	`created_at` integer NOT NULL
);
