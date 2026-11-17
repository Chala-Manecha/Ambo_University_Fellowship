CREATE TABLE `fast_scanners` (
	`fast_id` text NOT NULL,
	`member_id` text NOT NULL,
	`added_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`fast_id`, `member_id`),
	FOREIGN KEY (`fast_id`) REFERENCES `fasts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `fast_scanners_member_idx` ON `fast_scanners` (`member_id`);