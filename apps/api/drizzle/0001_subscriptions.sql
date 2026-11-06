ALTER TABLE `checkout_sessions` ADD `prepared_json` text;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `session_id` text;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `cancel_prepared_json` text;--> statement-breakpoint
CREATE INDEX `subscriptions_subscriber` ON `subscriptions` (`subscriber_address`);--> statement-breakpoint
CREATE UNIQUE INDEX `plans_onchain` ON `plans` (`onchain_plan_id`);