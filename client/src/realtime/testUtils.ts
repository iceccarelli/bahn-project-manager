import { EVENT_SCHEMA_VERSION, type DomainEvent } from "@shared/domain-events";
import type { ProjectDetail } from "@shared/project-contract";

let seq = 0;
export const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

export const project = (over: Partial<ProjectDetail> = {}): ProjectDetail => ({
  id: 1, version: 1, projektnummer: "P-1", bahnhofsmanagement: "Frankfurt", station: "Köln Hbf",
  projektstand: "EP", projektleiter: null, terminProjektvorstellung: null, updatedAt: "2026-01-01T00:00:00.000Z",
  bahnhofsnummer: null, streckennummer: null, projektbeschreibung: null, eigvEinstufung: null,
  kommentar: null, projektLink: null, createdAt: "2026-01-01T00:00:00.000Z", reviews: [], ...over,
});

export const event = (id: number, version: number, changes: DomainEvent["changes"], over: Partial<DomainEvent> = {}): DomainEvent => ({
  schemaVersion: EVENT_SCHEMA_VERSION, eventId: uuid(), eventType: "project.updated", aggregateType: "project",
  aggregateId: String(id), aggregateVersion: version, actorId: "2", actorName: "Markus",
  timestamp: new Date(1_700_000_000_000 + version * 1000).toISOString(), traceId: "trace-unit-0001", changes,
  context: { workspace: "Frankfurt" }, ...over,
});
