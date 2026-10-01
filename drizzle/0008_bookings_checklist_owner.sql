CREATE TABLE `schedule_slots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slotKey` varchar(32) NOT NULL,
	`datum` datetime NOT NULL,
	`von` varchar(8) NOT NULL,
	`bis` varchar(8) NOT NULL,
	`status` enum('Frei','Gebucht','Vorgebucht für IM','Vorgebucht für IT') NOT NULL DEFAULT 'Frei',
	`station` varchar(256),
	`bahnhofsmanagement` varchar(128),
	`projektleitung` varchar(256),
	`projektstand` varchar(128),
	`info` varchar(512),
	`hinweis` varchar(512),
	`projectId` int,
	`checklistId` int,
	`syncVersion` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `schedule_slots_id` PRIMARY KEY(`id`),
	CONSTRAINT `slot_key_uq` UNIQUE(`slotKey`)
);
--> statement-breakpoint
ALTER TABLE `project_checklists` ADD `createdBy` varchar(64);--> statement-breakpoint
CREATE INDEX `slot_datum_idx` ON `schedule_slots` (`datum`);--> statement-breakpoint
CREATE INDEX `slot_status_datum_idx` ON `schedule_slots` (`status`,`datum`);