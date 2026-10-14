CREATE TABLE `project_source_keys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`source` varchar(32) NOT NULL,
	`sourceKey` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `project_source_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `project_source_key_uq` UNIQUE(`source`,`sourceKey`)
);
--> statement-breakpoint
ALTER TABLE `itk_pruefberichte` ADD `projectId` int;--> statement-breakpoint
ALTER TABLE `itk_pruefberichte` ADD `projectLinkSource` varchar(16);--> statement-breakpoint
ALTER TABLE `itk_pruefberichte` ADD `projectLinkedAt` datetime;--> statement-breakpoint
CREATE INDEX `project_source_keys_project_idx` ON `project_source_keys` (`projectId`);--> statement-breakpoint
CREATE INDEX `itk_pb_project_idx` ON `itk_pruefberichte` (`projectId`);