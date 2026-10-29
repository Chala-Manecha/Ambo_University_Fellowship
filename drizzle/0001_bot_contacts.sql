CREATE TABLE `telegram_contacts` (
	`telegram_id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`first_name` text,
	`username` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
