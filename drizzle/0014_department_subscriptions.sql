CREATE TABLE `department_subscriptions` (
	`userId` varchar(64) NOT NULL,
	`department` varchar(64) NOT NULL,
	`enabled` boolean NOT NULL,
	`source` enum('user','admin') NOT NULL,
	`createdAt` datetime(3) NOT NULL,
	`updatedAt` datetime(3) NOT NULL,
	CONSTRAINT `department_subscriptions_userId_department_pk` PRIMARY KEY(`userId`,`department`)
);
--> statement-breakpoint
ALTER TABLE `notifications` ADD `department` varchar(64);--> statement-breakpoint
ALTER TABLE `notifications` ADD `dedupKey` varchar(128);--> statement-breakpoint
-- A server built before 0014 (still serving during a rolling deploy) inserts no dedupKey: derive the watcher form for it, so the
-- NOT NULL below holds for every writer and the migration is safe to run while the old version is up.
CREATE TRIGGER `notifications_dedup_default` BEFORE INSERT ON `notifications` FOR EACH ROW SET NEW.`dedupKey` = COALESCE(NEW.`dedupKey`, CONCAT('event:', NEW.`eventId`));--> statement-breakpoint
UPDATE `notifications` SET `dedupKey` = CONCAT('event:', `eventId`) WHERE `dedupKey` IS NULL;--> statement-breakpoint
ALTER TABLE `notifications` MODIFY COLUMN `dedupKey` varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE `notifications` DROP INDEX `notifications_user_event_uq`;--> statement-breakpoint
CREATE INDEX `notifications_user_event_idx` ON `notifications` (`userId`,`eventId`);--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `openId` varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `principalId` varchar(64);--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_dedup_uq` UNIQUE(`userId`,`dedupKey`);--> statement-breakpoint
CREATE INDEX `dept_subs_department_idx` ON `department_subscriptions` (`department`,`enabled`);--> statement-breakpoint
-- backfill: the principal id every OIDC user already acts under (server/domain/principalId.ts: 'o' + first 31 hex chars of
-- sha256(openId)), legacy cookie users act under their numeric id. SHA2(…,256) is lowercase hex, like Node's digest("hex").
-- Rows a pre-0014 server stored with a TRUNCATED openId (exactly 64 chars; a full Entra `oidc:<tid>:<oid>` is 78) belong to a
-- principal id that was hashed from the untruncated value: no derivation reproduces it. Such a row must never become a notification
-- recipient (it would be a ghost nobody signs in as) — its grant is dropped; the user is provisioned afresh on the next sign-in.
UPDATE `users` SET `grantSnapshot` = NULL, `principalId` = NULL WHERE `loginMethod` = 'oidc' AND CHAR_LENGTH(`openId`) = 64;--> statement-breakpoint
UPDATE `users` SET `principalId` = CONCAT('o', LEFT(SHA2(`openId`, 256), 31)) WHERE `loginMethod` = 'oidc' AND `principalId` IS NULL AND CHAR_LENGTH(`openId`) <> 64;--> statement-breakpoint
UPDATE `users` SET `principalId` = CAST(`id` AS CHAR) WHERE (`loginMethod` IS NULL OR `loginMethod` <> 'oidc') AND `principalId` IS NULL;--> statement-breakpoint
CREATE INDEX `users_principal_idx` ON `users` (`principalId`);
