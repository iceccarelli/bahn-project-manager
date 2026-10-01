CREATE TABLE `domain_events` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`eventId` varchar(36) NOT NULL,
	`eventType` varchar(64) NOT NULL,
	`aggregateType` varchar(32) NOT NULL,
	`aggregateId` int NOT NULL,
	`aggregateVersion` int NOT NULL,
	`envelope` json NOT NULL,
	`createdAt` datetime(3) NOT NULL,
	`processedAt` datetime(3),
	`failedAt` datetime(3),
	`failureReason` varchar(512),
	CONSTRAINT `domain_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `domain_events_eventId_uq` UNIQUE(`eventId`),
	CONSTRAINT `domain_events_aggregate_version_uq` UNIQUE(`aggregateType`,`aggregateId`,`aggregateVersion`)
);
--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`actorId` varchar(64) NOT NULL,
	`idempotencyKey` varchar(128) NOT NULL,
	`operation` varchar(64) NOT NULL,
	`requestHash` varchar(64) NOT NULL,
	`response` json,
	`createdAt` datetime(3) NOT NULL,
	CONSTRAINT `idempotency_keys_actorId_idempotencyKey_pk` PRIMARY KEY(`actorId`,`idempotencyKey`)
);
--> statement-breakpoint
ALTER TABLE `audit_log` ADD `eventId` varchar(36);--> statement-breakpoint
ALTER TABLE `audit_log` ADD `aggregateVersion` int;--> statement-breakpoint
ALTER TABLE `audit_log` ADD `traceId` varchar(64);--> statement-breakpoint
CREATE INDEX `domain_events_outbox_idx` ON `domain_events` (`processedAt`,`id`);--> statement-breakpoint
CREATE INDEX `idempotency_createdAt_idx` ON `idempotency_keys` (`createdAt`);--> statement-breakpoint
CREATE INDEX `projects_updatedAt_id_idx` ON `projects` (`updatedAt`,`id`);--> statement-breakpoint
CREATE FULLTEXT INDEX `projects_search_ft` ON `projects` (`projektnummer`, `station`, `projektbeschreibung`, `projektleiter`);
--> statement-breakpoint
CREATE TRIGGER `audit_log_no_update` BEFORE UPDATE ON `audit_log` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only';
--> statement-breakpoint
CREATE TRIGGER `audit_log_no_delete` BEFORE DELETE ON `audit_log` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only';
