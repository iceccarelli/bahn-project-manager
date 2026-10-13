ALTER TABLE `project_source_keys` MODIFY COLUMN `projectId` int;--> statement-breakpoint
ALTER TABLE `project_source_keys` ADD `kind` varchar(8) DEFAULT 'match' NOT NULL;