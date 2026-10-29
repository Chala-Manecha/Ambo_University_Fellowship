CREATE TABLE `fast_checkins` (
	`fast_id` text NOT NULL,
	`member_id` text NOT NULL,
	`date` text NOT NULL,
	`meal` text NOT NULL,
	`scanned_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`fast_id`, `member_id`, `date`, `meal`),
	FOREIGN KEY (`fast_id`) REFERENCES `fasts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scanned_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `fast_checkins_fast_date_idx` ON `fast_checkins` (`fast_id`,`date`);--> statement-breakpoint
CREATE TABLE `fast_registrations` (
	`fast_id` text NOT NULL,
	`member_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`fast_id`, `member_id`),
	FOREIGN KEY (`fast_id`) REFERENCES `fasts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `fasts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`meals` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `members` ADD `birth_date` text;--> statement-breakpoint
ALTER TABLE `members` ADD `title` text;--> statement-breakpoint
ALTER TABLE `members` ADD `services` text;--> statement-breakpoint
ALTER TABLE `members` ADD `other_service` text;--> statement-breakpoint
ALTER TABLE `members` ADD `learning` text;