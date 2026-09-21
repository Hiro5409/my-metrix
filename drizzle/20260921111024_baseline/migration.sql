CREATE TABLE `account` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_account_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `apikey` (
	`id` text PRIMARY KEY,
	`config_id` text NOT NULL,
	`name` text,
	`start` text,
	`prefix` text,
	`key` text NOT NULL,
	`reference_id` text NOT NULL,
	`refill_interval` integer,
	`refill_amount` integer,
	`last_refill_at` integer,
	`enabled` integer DEFAULT true,
	`rate_limit_enabled` integer DEFAULT false,
	`rate_limit_time_window` integer,
	`rate_limit_max` integer,
	`request_count` integer DEFAULT 0,
	`remaining` integer,
	`last_request` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`permissions` text,
	`metadata` text,
	CONSTRAINT `fk_apikey_reference_id_user_id_fk` FOREIGN KEY (`reference_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	CONSTRAINT `fk_session_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `measurements` (
	`grpid` integer PRIMARY KEY,
	`timestamp` integer NOT NULL,
	`weight_kg` real,
	`fat_ratio_percent` real,
	`fat_mass_kg` real,
	`fat_free_mass_kg` real,
	`muscle_mass_kg` real,
	`hydration_kg` real,
	`bone_mass_kg` real,
	`raw_json` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "measurements_raw_json_check" CHECK(json_valid("raw_json"))
);
--> statement-breakpoint
CREATE TABLE `withings_authorization` (
	`id` integer PRIMARY KEY DEFAULT 1,
	`state_hash` text NOT NULL,
	`status` text NOT NULL,
	`expires_at` integer NOT NULL,
	`error` text,
	`updated_at` integer NOT NULL,
	CONSTRAINT "withings_authorization_singleton_check" CHECK("id" = 1),
	CONSTRAINT "withings_authorization_status_check" CHECK("status" in ('pending', 'exchanging', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE `withings_connection` (
	`id` integer PRIMARY KEY DEFAULT 1,
	`token_json` text NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "withings_connection_singleton_check" CHECK("id" = 1)
);
--> statement-breakpoint
CREATE TABLE `withings_notifications` (
	`event_key` text PRIMARY KEY,
	`status` text NOT NULL,
	`error` text,
	`received_at` integer NOT NULL,
	`processed_at` integer,
	CONSTRAINT "withings_notifications_status_check" CHECK("status" in ('received', 'processed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE `withings_refresh_lease` (
	`id` integer PRIMARY KEY DEFAULT 1,
	`owner` text NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "withings_refresh_lease_singleton_check" CHECK("id" = 1)
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE INDEX `apikey_config_id_idx` ON `apikey` (`config_id`);--> statement-breakpoint
CREATE INDEX `apikey_key_idx` ON `apikey` (`key`);--> statement-breakpoint
CREATE INDEX `apikey_reference_id_idx` ON `apikey` (`reference_id`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE INDEX `measurements_timestamp_grpid_idx` ON `measurements` (`timestamp`,`grpid`);--> statement-breakpoint
CREATE INDEX `withings_notifications_received_at_idx` ON `withings_notifications` (`received_at`);--> statement-breakpoint
DROP TABLE IF EXISTS `oauth_token_locks`;--> statement-breakpoint
DROP TABLE IF EXISTS `oauth_tokens`;--> statement-breakpoint
DROP TABLE IF EXISTS `webhook_events`;--> statement-breakpoint
DROP TABLE IF EXISTS `body_measurements`;
