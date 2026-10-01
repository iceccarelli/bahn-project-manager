/**
 * Notification policy: which domain events notify, and how they read.
 *
 * Pure. Who RECEIVES one is decided elsewhere (watchers of the project, minus
 * the actor, minus anyone who can no longer see the project). This function
 * decides only whether the event is worth a notification and what it says —
 * so the policy can change without touching persistence or transport.
 */
import type { DomainEvent } from "@shared/domain-events";
import type { NotificationKind } from "@shared/notification-contract";
import { REVIEW_KEY_RE } from "@shared/project-contract";

export interface PlannedNotification { kind: NotificationKind; title: string; body: string | null; link: string }

const BLOCKING = /(gestoppt|gestopp|stopp|abgelehnt)/i;
const show = (v: string | null) => (v === null || v === "" ? "leer" : v);

export function planNotification(
  e: DomainEvent,
  project: { id: number; projektnummer: string | null; station: string | null },
): PlannedNotification | null {
  if (e.aggregateType !== "project") return null;
  const label = project.station || project.projektnummer || `Projekt ${project.id}`;
  const link = `/projects?projekt=${project.id}`;
  const actor = e.actorName ?? "Jemand";

  if (e.eventType === "project.deleted") {
    return { kind: "critical", title: `${label}: Projekt gelöscht`, body: `${actor} hat das Projekt gelöscht.`, link: "/projects" };
  }
  if (e.eventType !== "project.updated") return null;

  const lines: string[] = [];
  let kind: NotificationKind | null = null;
  const bump = (k: NotificationKind) => {
    const rank = ["system", "workflow", "mention", "assignment", "deadline", "critical"];
    if (kind === null || rank.indexOf(k) > rank.indexOf(kind)) kind = k;
  };

  for (const [key, c] of Object.entries(e.changes)) {
    const r = REVIEW_KEY_RE.exec(key);
    if (r) {
      const [, dept, field] = r;
      if (field === "status") { lines.push(`${dept}: ${show(c.from)} → ${show(c.to)}`); bump(c.to && BLOCKING.test(c.to) ? "critical" : "workflow"); }
      else if (field === "prueferName") { lines.push(`${dept}-Prüfer: ${show(c.from)} → ${show(c.to)}`); bump("assignment"); }
      continue;
    }
    switch (key) {
      case "projektstand": lines.push(`Projektstand: ${show(c.from)} → ${show(c.to)}`); bump(c.to && BLOCKING.test(c.to) ? "critical" : "workflow"); break;
      case "projektleiter": lines.push(`Projektleitung: ${show(c.from)} → ${show(c.to)}`); bump("assignment"); break;
      case "terminProjektvorstellung": lines.push(`Termin Projektvorstellung: ${show(c.from)} → ${show(c.to)}`); bump("deadline"); break;
      // bahnhofsmanagement / kommentar / free text: not worth interrupting anyone
    }
  }
  if (!kind || lines.length === 0) return null;
  return { kind, title: `${label}: ${lines[0]}`, body: `${actor}${lines.length > 1 ? ` · ${lines.length} Änderungen: ${lines.join("; ")}` : ""}`.slice(0, 1000), link };
}
