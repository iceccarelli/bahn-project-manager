ALTER TABLE `audit_log` ADD `workspace` varchar(128);--> statement-breakpoint
ALTER TABLE `audit_log` ADD `entityLabel` varchar(255);--> statement-breakpoint
CREATE INDEX `audit_workspace_id_idx` ON `audit_log` (`workspace`,`id`);
--> statement-breakpoint
-- Backfill the scope of existing project rows. audit_log is append-only, so the update trigger is lifted for exactly this
-- statement and recreated immediately. Rows of deleted projects, bookings and checklists keep workspace NULL, i.e. they are
-- visible to unrestricted principals only (the safe default).
DROP TRIGGER `audit_log_no_update`;
--> statement-breakpoint
UPDATE `audit_log` a JOIN `projects` p ON a.`entityType` = 'project' AND a.`entityId` = p.`id` SET a.`workspace` = p.`bahnhofsmanagement`, a.`entityLabel` = COALESCE(NULLIF(p.`station`, ''), p.`projektnummer`);
--> statement-breakpoint
CREATE TRIGGER `audit_log_no_update` BEFORE UPDATE ON `audit_log` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only';
