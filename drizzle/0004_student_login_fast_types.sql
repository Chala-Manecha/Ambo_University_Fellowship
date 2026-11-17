CREATE TABLE `login_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`failures` integer NOT NULL,
	`window_start` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `fast_registrations` ADD `fast_type` text DEFAULT 'meat_only' NOT NULL;--> statement-breakpoint
ALTER TABLE `members` ADD `student_id_key` text;--> statement-breakpoint
-- Existing members get their login key; if two share one, only the first gets it (an admin can fix the other)
UPDATE `members` SET `student_id_key` = UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(`student_id`, '/', ''), ' ', ''), '-', ''), '.', ''), '_', '')) WHERE rowid IN (SELECT MIN(rowid) FROM `members` GROUP BY UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(`student_id`, '/', ''), ' ', ''), '-', ''), '.', ''), '_', '')));--> statement-breakpoint
CREATE UNIQUE INDEX `members_student_id_key_unique` ON `members` (`student_id_key`);