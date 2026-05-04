CREATE TABLE `audit_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`userName` varchar(256),
	`entityType` varchar(64) NOT NULL,
	`entityId` int NOT NULL,
	`action` varchar(32) NOT NULL,
	`field` varchar(128),
	`oldValue` text,
	`newValue` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bvb_eea` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projektnummer` varchar(64),
	`bahnhofsmanagement` varchar(128),
	`station` varchar(256),
	`bahnhofsnummer` varchar(32),
	`streckennummer` varchar(32),
	`projektbeschreibung` text,
	`projektleiter` varchar(256),
	`eigvAnzeige` datetime,
	`datum` datetime,
	`kommentar` text,
	`freigabeNummer` varchar(128),
	`kosteneinsparung` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bvb_eea_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `department_reviews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`department` varchar(64) NOT NULL,
	`prueferName` varchar(256),
	`datum` datetime,
	`status` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `department_reviews_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projektnummer` varchar(64),
	`bahnhofsmanagement` varchar(128),
	`station` varchar(256),
	`bahnhofsnummer` varchar(32),
	`streckennummer` varchar(32),
	`projektbeschreibung` text,
	`eigvEinstufung` text,
	`projektleiter` varchar(256),
	`kommentar` text,
	`projektLink` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `psv_itk` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projektnummer` varchar(64),
	`bahnhofsmanagement` varchar(128),
	`station` varchar(256),
	`bahnhofsnummer` varchar(32),
	`streckennummer` varchar(32),
	`projektbeschreibung` text,
	`projektstand` varchar(128),
	`projektleiter` varchar(256),
	`terminProjektvorstellung` datetime,
	`itkPruefer` varchar(256),
	`datum` datetime,
	`kommentar` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `psv_itk_id` PRIMARY KEY(`id`)
);
