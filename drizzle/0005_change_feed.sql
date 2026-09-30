ALTER TABLE `domain_events` ADD `feedSeq` bigint;--> statement-breakpoint
ALTER TABLE `domain_events` ADD CONSTRAINT `domain_events_feedSeq_uq` UNIQUE(`feedSeq`);--> statement-breakpoint
CREATE INDEX `domain_events_pending_seq_idx` ON `domain_events` (`processedAt`,`feedSeq`);