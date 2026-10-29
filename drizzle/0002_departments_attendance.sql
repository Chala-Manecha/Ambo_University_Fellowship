CREATE TABLE `attendance_records` (
	`session_id` text NOT NULL,
	`member_id` text NOT NULL,
	`status` text NOT NULL,
	`recorded_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`session_id`, `member_id`),
	FOREIGN KEY (`session_id`) REFERENCES `attendance_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recorded_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `attendance_records_member_idx` ON `attendance_records` (`member_id`);--> statement-breakpoint
CREATE TABLE `attendance_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`department_id` text,
	`title` text NOT NULL,
	`date` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `attendance_sessions_dept_date_idx` ON `attendance_sessions` (`department_id`,`date`);--> statement-breakpoint
CREATE TABLE `department_members` (
	`id` text PRIMARY KEY NOT NULL,
	`department_id` text NOT NULL,
	`member_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dept_member_unique` ON `department_members` (`department_id`,`member_id`);--> statement-breakpoint
CREATE INDEX `dept_member_member_idx` ON `department_members` (`member_id`);--> statement-breakpoint
CREATE TABLE `departments` (
	`id` text PRIMARY KEY NOT NULL,
	`name_om` text NOT NULL,
	`name_am` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `user` ADD `position` text;
--> statement-breakpoint
INSERT INTO `departments` (`id`, `name_om`, `name_am`, `sort_order`) VALUES ('qoannoo', 'Kutaa Qo''annoo fi Qorannoo', 'ጥናት እና ምርምር ክፍል', 1);
--> statement-breakpoint
INSERT INTO `departments` (`id`, `name_om`, `name_am`, `sort_order`) VALUES ('karoora', 'Kutaa Karooraa fi Hordoffii', 'እቅድ እና ክትትል ክፍል', 2);
--> statement-breakpoint
INSERT INTO `departments` (`id`, `name_om`, `name_am`, `sort_order`) VALUES ('ogbarruu', 'Kutaa Ogbarruu', 'ኪነ ጥበብ ክፍል', 3);
--> statement-breakpoint
INSERT INTO `departments` (`id`, `name_om`, `name_am`, `sort_order`) VALUES ('miseensa', 'Kutaa Dhimma Miseensaa', 'አባላት ጉዳይ', 4);
--> statement-breakpoint
INSERT INTO `departments` (`id`, `name_om`, `name_am`, `sort_order`) VALUES ('afaan', 'Kutaa Tajaajila Afaanii fi Fedhii Addaa', 'ቋንቋ እና ልዩ ፍላጎት', 5);
--> statement-breakpoint
INSERT INTO `departments` (`id`, `name_om`, `name_am`, `sort_order`) VALUES ('barnoota', 'Kutaa Barnootaa', 'ትምህርት ክፍል', 6);
--> statement-breakpoint
INSERT INTO `departments` (`id`, `name_om`, `name_am`, `sort_order`) VALUES ('ogummaa', 'Kutaa Ogummaa fi Gargaarsaa', 'ሙያ እና ተራድኦ', 7);
--> statement-breakpoint
INSERT INTO `departments` (`id`, `name_om`, `name_am`, `sort_order`) VALUES ('baachii', 'Baachii fi Departimentii', 'ባች እና ዲፓርትመንት', 8);
--> statement-breakpoint
INSERT INTO `departments` (`id`, `name_om`, `name_am`, `sort_order`) VALUES ('faaruu', 'Kutaa Faaruu', 'መዝሙር ክፍል', 9);
