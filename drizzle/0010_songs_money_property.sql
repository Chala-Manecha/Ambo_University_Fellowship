CREATE TABLE `donations` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text,
	`donor_name` text NOT NULL,
	`amount` integer NOT NULL,
	`note` text,
	`receipt_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`review_note` text,
	`reviewed_by` text,
	`reviewed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reviewed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `donations_status_idx` ON `donations` (`status`);--> statement-breakpoint
CREATE TABLE `ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`direction` text NOT NULL,
	`amount` integer NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`date` text NOT NULL,
	`person` text,
	`ref_id` text,
	`recorded_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`recorded_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ledger_date_idx` ON `ledger` (`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_ref_unique` ON `ledger` (`ref_id`);--> statement-breakpoint
CREATE TABLE `properties` (
	`id` text PRIMARY KEY NOT NULL,
	`department_id` text NOT NULL,
	`name` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`description` text,
	`source` text NOT NULL,
	`recorded_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recorded_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `properties_department_idx` ON `properties` (`department_id`);--> statement-breakpoint
CREATE TABLE `songs` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`audio_key` text,
	`audio_type` text,
	`released` integer DEFAULT false NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `songs_released_idx` ON `songs` (`released`);--> statement-breakpoint
INSERT OR IGNORE INTO `departments` (`id`, `name_om`, `name_am`, `sort_order`) VALUES ('odiitii', 'Kutaa Odiitii fi Sakatta''iinsaa', 'ኦዲት እና ምርመራ', 10);
--> statement-breakpoint
INSERT OR IGNORE INTO `departments` (`id`, `name_om`, `name_am`, `sort_order`) VALUES ('herrega', 'Kutaa Herregaa fi Qabeenyaa', 'ሂሳብ እና ንብረት ክፍል', 11);
--> statement-breakpoint
-- Money already approved goes into the ledger, so it survives a member being removed
INSERT OR IGNORE INTO `ledger` (`id`, `direction`, `amount`, `category`, `description`, `date`, `person`, `ref_id`)
SELECT lower(hex(randomblob(16))), 'in', c.`amount`, 'contribution', 'Monthly contribution', date(coalesce(c.`reviewed_at`, c.`created_at`) / 1000 + 3 * 3600, 'unixepoch'), m.`full_name`, c.`id`
FROM `contributions` c JOIN `members` m ON m.`id` = c.`member_id` WHERE c.`status` = 'approved';
