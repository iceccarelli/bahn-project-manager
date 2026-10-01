CREATE TABLE `notification_unread` (
	`userId` varchar(64) NOT NULL,
	`workspace` varchar(128) NOT NULL,
	`n` int NOT NULL DEFAULT 0,
	CONSTRAINT `notification_unread_userId_workspace_pk` PRIMARY KEY(`userId`,`workspace`)
);
--> statement-breakpoint
CREATE TABLE `project_geo` (
	`projectId` int NOT NULL,
	`lat` double NOT NULL,
	`lng` double NOT NULL,
	`stationKey` varchar(64) NOT NULL,
	`stationName` varchar(255) NOT NULL,
	`precision` enum('exact','tokens','fuzzy','region') NOT NULL,
	CONSTRAINT `project_geo_projectId` PRIMARY KEY(`projectId`)
);
--> statement-breakpoint
CREATE TABLE `rm_project_stats` (
	`workspace` varchar(128) NOT NULL,
	`projects` int NOT NULL DEFAULT 0,
	CONSTRAINT `rm_project_stats_workspace_pk` PRIMARY KEY(`workspace`)
);
--> statement-breakpoint
CREATE TABLE `rm_pruefer_load` (
	`workspace` varchar(128) NOT NULL,
	`pruefer` varchar(256) NOT NULL,
	`n` int NOT NULL DEFAULT 0,
	CONSTRAINT `rm_pruefer_load_workspace_pruefer_pk` PRIMARY KEY(`workspace`,`pruefer`)
);
--> statement-breakpoint
CREATE TABLE `rm_review_stats` (
	`workspace` varchar(128) NOT NULL,
	`department` varchar(64) NOT NULL,
	`status` varchar(128) NOT NULL,
	`n` int NOT NULL DEFAULT 0,
	CONSTRAINT `rm_review_stats_workspace_department_status_pk` PRIMARY KEY(`workspace`,`department`,`status`)
);
--> statement-breakpoint
CREATE INDEX `project_geo_lat_lng_idx` ON `project_geo` (`lat`,`lng`);--> statement-breakpoint
CREATE INDEX `project_geo_station_idx` ON `project_geo` (`stationKey`);
--> statement-breakpoint
INSERT INTO rm_project_stats (workspace, projects) SELECT COALESCE(bahnhofsmanagement, ''), COUNT(*) FROM projects GROUP BY COALESCE(bahnhofsmanagement, '');
--> statement-breakpoint
INSERT INTO rm_review_stats (workspace, department, status, n) SELECT COALESCE(p.bahnhofsmanagement, ''), r.department, COALESCE(r.status, ''), COUNT(*) FROM department_reviews r JOIN projects p ON p.id = r.projectId GROUP BY COALESCE(p.bahnhofsmanagement, ''), r.department, COALESCE(r.status, '');
--> statement-breakpoint
INSERT INTO rm_pruefer_load (workspace, pruefer, n) SELECT COALESCE(p.bahnhofsmanagement, ''), TRIM(r.prueferName), COUNT(*) FROM department_reviews r JOIN projects p ON p.id = r.projectId WHERE r.prueferName IS NOT NULL AND TRIM(r.prueferName) NOT IN ('', 'Zuordnung erforderlich') GROUP BY COALESCE(p.bahnhofsmanagement, ''), TRIM(r.prueferName);
--> statement-breakpoint
INSERT INTO notification_unread (userId, workspace, n) SELECT userId, COALESCE(workspace, ''), COUNT(*) FROM notifications WHERE readAt IS NULL GROUP BY userId, COALESCE(workspace, '');
