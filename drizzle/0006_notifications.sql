CREATE TABLE `notifications` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`userId` varchar(64) NOT NULL,
	`kind` enum('critical','workflow','assignment','mention','deadline','system') NOT NULL,
	`title` varchar(256) NOT NULL,
	`body` varchar(1024),
	`link` varchar(256),
	`workspace` varchar(128),
	`eventId` varchar(36) NOT NULL,
	`createdAt` datetime(3) NOT NULL,
	`readAt` datetime(3),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `notifications_user_event_uq` UNIQUE(`userId`,`eventId`)
);
--> statement-breakpoint
CREATE TABLE `project_watchers` (
	`projectId` int NOT NULL,
	`userId` varchar(64) NOT NULL,
	`createdAt` datetime(3) NOT NULL,
	CONSTRAINT `project_watchers_projectId_userId_pk` PRIMARY KEY(`projectId`,`userId`)
);
--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`userId`,`id`);--> statement-breakpoint
CREATE INDEX `watchers_user_idx` ON `project_watchers` (`userId`);