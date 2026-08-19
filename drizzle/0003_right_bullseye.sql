CREATE TABLE `project_checklist_answers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`checklistId` int NOT NULL,
	`questionKey` varchar(64) NOT NULL,
	`nr` int NOT NULL,
	`answer` varchar(512),
	`secondary` varchar(8),
	`comment` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `project_checklist_answers_id` PRIMARY KEY(`id`),
	CONSTRAINT `checklist_question_unique` UNIQUE(`checklistId`,`questionKey`)
);
--> statement-breakpoint
CREATE TABLE `project_checklists` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int,
	`mode` varchar(32) NOT NULL,
	`status` enum('draft','submitted','cancelled') NOT NULL DEFAULT 'draft',
	`projektnummer` varchar(256),
	`projektbezeichnung` varchar(512),
	`stationsname` varchar(256),
	`bahnhofsnummer` varchar(32),
	`streckennummer` varchar(32),
	`projektstand` varchar(128),
	`bahnhofsmanagement` varchar(128),
	`projektleitung` varchar(256),
	`pkpLink` text,
	`freischaltungFaa` varchar(64),
	`unterschriftenblatt` varchar(64),
	`mitProjektvorstellung` varchar(8),
	`uebergabeDatum` datetime,
	`anmerkungen` text,
	`terminDatum` datetime,
	`terminVon` varchar(8),
	`terminBis` varchar(8),
	`submittedAt` timestamp,
	`submittedBy` varchar(256),
	`syncVersion` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `project_checklists_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `originalRowIndex` int;--> statement-breakpoint
ALTER TABLE `projects` ADD `fullRowData` json;--> statement-breakpoint
ALTER TABLE `projects` ADD `projektstand` varchar(128);--> statement-breakpoint
ALTER TABLE `projects` ADD `terminProjektvorstellung` datetime;--> statement-breakpoint
ALTER TABLE `projects` ADD `syncVersion` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `department_reviews` ADD CONSTRAINT `project_dept_unique` UNIQUE(`projectId`,`department`);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `openId_idx` UNIQUE(`openId`);--> statement-breakpoint
CREATE INDEX `answer_checklistId_idx` ON `project_checklist_answers` (`checklistId`);--> statement-breakpoint
CREATE INDEX `answer_questionKey_idx` ON `project_checklist_answers` (`questionKey`);--> statement-breakpoint
CREATE INDEX `checklist_projectId_idx` ON `project_checklists` (`projectId`);--> statement-breakpoint
CREATE INDEX `checklist_status_idx` ON `project_checklists` (`status`);--> statement-breakpoint
CREATE INDEX `checklist_projektnummer_idx` ON `project_checklists` (`projektnummer`);--> statement-breakpoint
CREATE INDEX `checklist_termin_idx` ON `project_checklists` (`terminDatum`);--> statement-breakpoint
CREATE INDEX `checklist_bahnhofsmanagement_idx` ON `project_checklists` (`bahnhofsmanagement`);--> statement-breakpoint
CREATE INDEX `entity_idx` ON `audit_log` (`entityType`,`entityId`);--> statement-breakpoint
CREATE INDEX `user_idx` ON `audit_log` (`userId`);--> statement-breakpoint
CREATE INDEX `createdAt_idx` ON `audit_log` (`createdAt`);--> statement-breakpoint
CREATE INDEX `bvb_projektnummer_idx` ON `bvb_eea` (`projektnummer`);--> statement-breakpoint
CREATE INDEX `projectId_idx` ON `department_reviews` (`projectId`);--> statement-breakpoint
CREATE INDEX `department_idx` ON `department_reviews` (`department`);--> statement-breakpoint
CREATE INDEX `status_idx` ON `department_reviews` (`status`);--> statement-breakpoint
CREATE INDEX `projektnummer_idx` ON `projects` (`projektnummer`);--> statement-breakpoint
CREATE INDEX `bahnhofsmanagement_idx` ON `projects` (`bahnhofsmanagement`);--> statement-breakpoint
CREATE INDEX `station_idx` ON `projects` (`station`);--> statement-breakpoint
CREATE INDEX `projektstand_idx` ON `projects` (`projektstand`);--> statement-breakpoint
CREATE INDEX `projektleiter_idx` ON `projects` (`projektleiter`);--> statement-breakpoint
CREATE INDEX `syncVersion_idx` ON `projects` (`syncVersion`);--> statement-breakpoint
CREATE INDEX `region_stand_idx` ON `projects` (`bahnhofsmanagement`,`projektstand`);--> statement-breakpoint
CREATE INDEX `psv_projektnummer_idx` ON `psv_itk` (`projektnummer`);--> statement-breakpoint
CREATE INDEX `role_idx` ON `users` (`role`);