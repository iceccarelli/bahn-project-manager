/**
 * What Ask Bahn can do.
 *
 * One skill per question a person actually asks this website. Each one runs a
 * query and returns measured facts; none of them writes a number it did not
 * compute. A skill that cannot answer says so and hands back what it does know
 * — the assistant's failure mode is "I don't have that", never a plausible
 * sentence containing an invented figure.
 */

import {
  agingOfOpenReviews,
  dataQuality,
  gewerkStandings,
  reviewerConcentration,
} from "../portfolio-metrics";
import { DEPARTMENT_LIST } from "../validation";
import { normalizeReviewStatus, OPEN_STATUSES, BLOCKING_STATUSES } from "../review-status";
import { recipientsFor } from "../contacts";
import { gewerkHref } from "../search-index";
import { severityOf } from "../audit-entry";
import { formatGerman } from "../date";
import type {
  AgentAction,
  AgentTone,
  AgentAnswer,
  AgentContext,
  AgentFact,
  AgentProject,
} from "./types";

const de = (n: number) => n.toLocaleString("de-DE");
const q = (s: string) => `/projects?q=${encodeURIComponent(s)}`;

const isOpenStatus = (s: string | null) =>
  s !== null && (OPEN_STATUSES as readonly string[]).includes(s);
const isBlockedStatus = (s: string | null) =>
  s !== null && (BLOCKING_STATUSES as readonly string[]).includes(s);

/** Entities a question can carry, pulled out of the text by the resolver. */
export interface AgentEntities {
  department?: string;
  station?: string;
  person?: string;
  projektnummer?: string;
  region?: string;
}

export interface Skill {
  id: string;
  /** What the reader would say. Shown in the help answer, so it stays honest. */
  example: string;
  /** Folded keywords, any of which puts this skill in play. */
  keywords: readonly string[];
  /** Higher wins when several match. */
  weight: number;
  /** Requires an entity of this kind to be usable. */
  needs?: keyof AgentEntities;
  run(ctx: AgentContext, entities: AgentEntities): AgentAnswer;
}

const answer = (
  intent: string,
  headline: string,
  facts: AgentFact[],
  actions: AgentAction[],
  basis: string,
): AgentAnswer => ({ intent, headline, facts, actions, basis, confidence: "measured" });

// ---------------------------------------------------------------------------

const gewerkStatus: Skill = {
  id: "gewerk-status",
  example: "Wie steht EEA?",
  keywords: ["gewerk", "status", "offen", "wie steht", "wie viele", "prufungen", "prüfungen"],
  weight: 60,
  needs: "department",
  run(ctx, e) {
    const department = e.department as string;
    const s = gewerkStandings(ctx.projects, [department], ctx.today)[0];
    if (!s) {
      return {
        intent: "gewerk-status",
        headline: `${department} kommt in den geladenen Daten nicht vor.`,
        facts: [],
        actions: [],
        basis: "Geprüft gegen alle Prüfzeilen der geladenen Projekte.",
        confidence: "unknown",
      };
    }
    return answer(
      "gewerk-status",
      `${department}: ${de(s.required)} erforderliche Prüfungen, ${de(s.open)} davon offen.`,
      [
        { label: "erforderlich", value: de(s.required), href: gewerkHref(department) },
        { label: "offen", value: de(s.open), tone: s.open > 0 ? "warn" : "ok" },
        { label: "zugestimmt", value: de(s.approved), tone: "ok" },
        {
          label: "blockiert",
          value: de(s.blocked),
          tone: s.blocked > 0 ? "critical" : "ok",
        },
        { label: "überfällig", value: de(s.overdue), tone: s.overdue > 0 ? "warn" : "ok" },
        { label: "ohne Prüfer", value: de(s.unassigned), tone: s.unassigned > 0 ? "warn" : "ok" },
        ...(s.approved === 0 && s.required > 0
          ? [
              {
                label: "Hinweis",
                value: `keine Zustimmung im Bestand — ${de(s.other)} Zeilen tragen einen anderen Abschluss`,
                tone: "warn" as const,
              },
            ]
          : []),
      ],
      [{ label: `${department} öffnen`, href: gewerkHref(department), kind: "navigate" }],
      "Gezählt über alle Prüfzeilen dieses Gewerks, ohne „nicht erforderlich“.",
    );
  },
};

const mostCritical: Skill = {
  id: "most-critical",
  example: "Was ist gerade kritisch?",
  keywords: [
    "kritisch", "dringend", "brennt", "problem", "worauf", "zuerst", "prioritat",
    "priorität", "handlungsbedarf", "schlimm", "risiko",
  ],
  weight: 90,
  run(ctx) {
    const all = gewerkStandings(ctx.projects, DEPARTMENT_LIST, ctx.today).sort(
      (a, b) => b.riskScore - a.riskScore,
    );
    const top = all.slice(0, 3);
    const lead = top[0];
    if (!lead) {
      return {
        intent: "most-critical",
        headline: "Es sind keine Prüfdaten geladen.",
        facts: [],
        actions: [],
        basis: "Keine Projekte im Speicher.",
        confidence: "unknown",
      };
    }
    const blockedTotal = all.reduce((a, s) => a + s.blocked, 0);
    const overdueTotal = all.reduce((a, s) => a + s.overdue, 0);
    return answer(
      "most-critical",
      `${lead.department} steht am schlechtesten: ${de(lead.blocked)} blockiert, ${de(lead.overdue)} überfällig, ${de(lead.unassigned)} ohne Prüfer.`,
      [
        ...top.map((s) => ({
          label: s.department,
          value: `${de(s.blocked)} blockiert · ${de(s.overdue)} überfällig · ${de(s.unassigned)} ohne Prüfer`,
          tone: (s.blocked > 0 ? "critical" : "warn") as AgentTone,
          href: gewerkHref(s.department),
        })),
        { label: "blockiert insgesamt", value: de(blockedTotal), tone: "critical" },
        { label: "überfällig insgesamt", value: de(overdueTotal), tone: "warn" },
      ],
      [
        { label: `${lead.department} öffnen`, href: gewerkHref(lead.department), kind: "navigate" },
        { label: "Alle blockierten zeigen", href: q("abgelehnt"), kind: "navigate" },
      ],
      "Rangfolge aus blockiert ×3 + überfällig ×2 + ohne Prüfer ×1. Eine Priorisierungshilfe, keine Messung.",
    );
  },
};

const overdue: Skill = {
  id: "overdue",
  example: "Was ist überfällig?",
  keywords: ["uberfallig", "überfällig", "verzug", "verspatet", "verspätet", "termin", "frist", "deadline"],
  weight: 80,
  run(ctx) {
    const standings = gewerkStandings(ctx.projects, DEPARTMENT_LIST, ctx.today);
    const total = standings.reduce((a, s) => a + s.overdue, 0);
    const worst = [...standings].sort((a, b) => b.overdue - a.overdue).slice(0, 4);
    const oldest = standings.reduce<number | null>(
      (a, s) => (s.oldestOpenDays !== null && (a === null || s.oldestOpenDays > a) ? s.oldestOpenDays : a),
      null,
    );
    return answer(
      "overdue",
      `${de(total)} offene Prüfungen liegen hinter ihrem eingetragenen Prüfdatum.`,
      [
        ...worst.map((s) => ({
          label: s.department,
          value: de(s.overdue),
          tone: (s.overdue > 0 ? "warn" : "ok") as AgentTone,
          href: gewerkHref(s.department),
        })),
        ...(oldest !== null
          ? [{ label: "älteste offene Prüfung", value: `${de(oldest)} Tage`, tone: "critical" as const }]
          : []),
      ],
      [{ label: "Dashboard öffnen", href: "/", kind: "navigate" }],
      "Offene Prüfzeilen, deren Prüfdatum vor heute liegt.",
    );
  },
};

const aging: Skill = {
  id: "aging",
  example: "Wie alt sind die offenen Prüfungen?",
  keywords: ["alt", "alter", "liegt", "lange", "dauer", "median", "backlog", "ruckstand", "rückstand"],
  weight: 70,
  run(ctx) {
    const a = agingOfOpenReviews(ctx.projects, ctx.today);
    const overYear = a.cohorts.find((c) => c.key === "365+")?.count ?? 0;
    return answer(
      "aging",
      a.medianAgeDays === null
        ? "Keine der offenen Prüfungen trägt ein Datum, sie lassen sich nicht altern."
        : `Die mittlere offene Prüfung liegt seit ${de(a.medianAgeDays)} Tagen.`,
      [
        ...a.cohorts.map((c) => ({
          label: c.label,
          value: de(c.count),
          tone: (c.key === "365+" ? "critical" : c.key === "181-365" ? "warn" : "neutral") as AgentTone,
        })),
        {
          label: "ohne Prüfdatum",
          value: `${de(a.undatedOpen)} — nicht alterbar`,
          tone: "warn",
        },
        { label: "älter als ein Jahr", value: de(overYear), tone: "critical" },
      ],
      [{ label: "Dashboard öffnen", href: "/", kind: "navigate" }],
      "Abstand zwischen dem eingetragenen Prüfdatum und heute, je offener Prüfzeile.",
    );
  },
};

const workload: Skill = {
  id: "workload",
  example: "Wer hat die meiste offene Last?",
  keywords: ["wer", "prufer", "prüfer", "last", "auslastung", "verteilt", "team", "personen", "kapazitat", "kapazität"],
  weight: 70,
  run(ctx) {
    const c = reviewerConcentration(ctx.projects);
    const top = c.reviewers.slice(0, 5);
    const lead = top[0];
    return answer(
      "workload",
      lead
        ? `${lead.name} hält mit ${de(lead.open)} offenen Prüfungen die größte Last; die fünf größten zusammen ${c.topFiveShareOfOpen}%.`
        : "Auf keiner offenen Prüfung steht ein Name.",
      [
        ...top.map((r) => ({
          label: r.name,
          value: `${de(r.open)} offen · ${de(r.done)} erledigt`,
          tone: (r.open > 40 ? "critical" : "neutral") as AgentTone,
          href: q(r.name),
        })),
        {
          label: "offen ohne benannten Prüfer",
          value: de(c.unassignedOpen),
          tone: c.unassignedOpen > 0 ? "warn" : "ok",
        },
        { label: "Prüfer insgesamt", value: de(c.reviewers.length) },
      ],
      [{ label: "Dashboard öffnen", href: "/", kind: "navigate" }],
      "Gezählt über alle erforderlichen Prüfzeilen mit einem eingetragenen Namen.",
    );
  },
};

const unassigned: Skill = {
  id: "unassigned",
  example: "Welche Prüfungen haben keinen Prüfer?",
  keywords: ["ohne prufer", "ohne prüfer", "unbesetzt", "niemand", "kein prufer", "kein prüfer", "unzugeordnet"],
  weight: 75,
  run(ctx) {
    const standings = gewerkStandings(ctx.projects, DEPARTMENT_LIST, ctx.today);
    const total = standings.reduce((a, s) => a + s.unassigned, 0);
    const worst = [...standings].filter((s) => s.unassigned > 0).sort((a, b) => b.unassigned - a.unassigned);
    return answer(
      "unassigned",
      `${de(total)} offene Prüfungen tragen keinen Prüfernamen.`,
      worst.slice(0, 5).map((s) => ({
        label: s.department,
        value: de(s.unassigned),
        tone: "warn" as const,
        href: gewerkHref(s.department),
      })),
      worst[0]
        ? [{ label: `${worst[0].department} öffnen`, href: gewerkHref(worst[0].department), kind: "navigate" as const }]
        : [],
      "Offene Prüfzeilen, deren Prüferfeld leer ist.",
    );
  },
};

const blocked: Skill = {
  id: "blocked",
  example: "Welche Projekte sind blockiert?",
  keywords: ["blockiert", "abgelehnt", "gestoppt", "steht still", "gesperrt"],
  weight: 80,
  run(ctx) {
    const rows: Array<{ project: AgentProject; department: string; status: string }> = [];
    for (const p of ctx.projects) {
      for (const r of p.reviews ?? []) {
        const s = normalizeReviewStatus(r.status);
        if (isBlockedStatus(s)) rows.push({ project: p, department: r.department, status: s as string });
      }
    }
    const byDept = new Map<string, number>();
    for (const r of rows) byDept.set(r.department, (byDept.get(r.department) ?? 0) + 1);
    const projects = new Set(rows.map((r) => r.project.id));
    return answer(
      "blocked",
      `${de(rows.length)} Prüfungen sind abgelehnt oder gestoppt, verteilt auf ${de(projects.size)} Projekte.`,
      [
        ...[...byDept.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([department, count]) => ({
            label: department,
            value: de(count),
            tone: "critical" as const,
            href: gewerkHref(department),
          })),
        ...rows.slice(0, 3).map((r) => ({
          label: `${r.project.projektnummer ?? `Projekt ${r.project.id}`} · ${r.project.station ?? ""}`.trim(),
          value: `${r.department}: ${r.status}`,
          tone: "critical" as const,
          href: q(r.project.projektnummer ?? r.project.station ?? ""),
        })),
      ],
      [{ label: "Abgelehnte zeigen", href: q("abgelehnt"), kind: "navigate" }],
      "Prüfzeilen im Status „abgelehnt“ oder „gestoppt“.",
    );
  },
};

const findProject: Skill = {
  id: "find-project",
  example: "Zeig mir G.011540063",
  keywords: ["projekt", "zeig", "offne", "öffne", "such", "finde", "wo ist"],
  weight: 85,
  needs: "projektnummer",
  run(ctx, e) {
    const nummer = e.projektnummer as string;
    const matches = ctx.projects.filter(
      (p) => (p.projektnummer ?? "").toLowerCase() === nummer.toLowerCase(),
    );
    if (matches.length === 0) {
      return {
        intent: "find-project",
        headline: `Zu „${nummer}“ ist kein Projekt geladen.`,
        facts: [],
        actions: [{ label: "In Projekte suchen", href: q(nummer), kind: "navigate" }],
        basis: "Verglichen mit der Projektnummer jedes geladenen Projekts.",
        confidence: "unknown",
      };
    }
    const first = matches[0] as AgentProject;
    const openHere = (first.reviews ?? []).filter((r) => isOpenStatus(normalizeReviewStatus(r.status)));
    return answer(
      "find-project",
      matches.length === 1
        ? `${nummer} — ${first.station ?? "ohne Station"}, ${de(openHere.length)} offene Prüfungen.`
        : `${nummer} bezeichnet ${de(matches.length)} Projekte — die Nummer ist eine Programmnummer.`,
      [
        { label: "Station", value: first.station || "—" },
        { label: "Bahnhofsmanagement", value: first.bahnhofsmanagement || "—" },
        { label: "Projektleitung", value: first.projektleiter || "—" },
        {
          label: "Termin Projektvorstellung",
          value: formatGerman(first.terminProjektvorstellung ?? null) || "—",
        },
        { label: "offene Prüfungen", value: de(openHere.length), tone: openHere.length ? "warn" : "ok" },
      ],
      [{ label: "Projekt öffnen", href: q(nummer), kind: "navigate" }],
      "Aus dem geladenen Projektdatensatz.",
    );
  },
};

const stationInfo: Skill = {
  id: "station",
  example: "Was läuft in Frankfurt?",
  keywords: ["station", "bahnhof", "ort", "lauft", "läuft", "los"],
  weight: 55,
  needs: "station",
  run(ctx, e) {
    const station = e.station as string;
    const here = ctx.projects.filter(
      (p) => (p.station ?? "").toLowerCase() === station.toLowerCase(),
    );
    let open = 0;
    let blockedCount = 0;
    for (const p of here) {
      for (const r of p.reviews ?? []) {
        const s = normalizeReviewStatus(r.status);
        if (isOpenStatus(s)) open++;
        if (isBlockedStatus(s)) blockedCount++;
      }
    }
    return answer(
      "station",
      `${station}: ${de(here.length)} Projekte, ${de(open)} offene Prüfungen, ${de(blockedCount)} blockiert.`,
      [
        { label: "Projekte", value: de(here.length) },
        { label: "offene Prüfungen", value: de(open), tone: open ? "warn" : "ok" },
        { label: "blockiert", value: de(blockedCount), tone: blockedCount ? "critical" : "ok" },
        ...here.slice(0, 3).map((p) => ({
          label: p.projektnummer || `Projekt ${p.id}`,
          value: p.projektbeschreibung || "—",
          href: q(p.projektnummer || station),
        })),
      ],
      [
        { label: "Station öffnen", href: `/projects?q=${encodeURIComponent(station)}&view=cards`, kind: "navigate" },
        { label: "Auf der Karte", href: "/projects?view=map", kind: "navigate" },
      ],
      "Projekte, deren Station exakt so heißt.",
    );
  },
};

const recentChanges: Skill = {
  id: "recent-changes",
  example: "Was hat sich geändert?",
  keywords: ["geandert", "geändert", "anderung", "änderung", "historie", "passiert", "neu", "zuletzt", "heute"],
  weight: 75,
  run(ctx) {
    const entries = ctx.audit;
    if (entries.length === 0) {
      return {
        intent: "recent-changes",
        headline: "Seit dem Start dieser Sitzung wurde nichts geändert.",
        facts: [],
        actions: [{ label: "Änderungshistorie öffnen", href: "/audit", kind: "navigate" }],
        basis: "Die Änderungshistorie ist leer.",
        confidence: "measured",
      };
    }
    const critical = entries.filter((e) => severityOf(e.action, e.meta) === "kritisch");
    const day = 24 * 3_600_000;
    const last24 = entries.filter((e) => ctx.today - Date.parse(e.timestamp) <= day);
    return answer(
      "recent-changes",
      `${de(entries.length)} Einträge in der Änderungshistorie, ${de(critical.length)} davon kritisch.`,
      [
        { label: "letzte 24 Stunden", value: de(last24.length) },
        { label: "kritisch", value: de(critical.length), tone: critical.length ? "critical" : "ok" },
        ...entries.slice(0, 3).map((e) => ({
          label: `${e.user} · ${e.action}`,
          value:
            [e.meta?.projektnummer, e.meta?.department, e.meta?.field]
              .filter(Boolean)
              .join(" · ") || e.details,
          tone: (severityOf(e.action, e.meta) === "kritisch" ? "critical" : "neutral") as AgentTone,
        })),
      ],
      [{ label: "Änderungshistorie öffnen", href: "/audit", kind: "navigate" }],
      "Aus der Änderungshistorie dieses Browsers.",
    );
  },
};

const quality: Skill = {
  id: "data-quality",
  example: "Wie verlässlich sind die Zahlen?",
  keywords: ["verlasslich", "verlässlich", "qualitat", "qualität", "sauber", "luck", "lücke", "fehlt", "vertrauen", "belastbar"],
  weight: 70,
  run(ctx) {
    const dq = dataQuality(ctx.projects);
    return answer(
      "data-quality",
      `${de(dq.totalReviews)} Prüfzeilen über ${de(dq.totalProjects)} Projekte; ${de(dq.openWithoutDate)} offene Zeilen tragen kein Datum.`,
      [
        { label: "Prüfzeilen ohne Status", value: de(dq.reviewsWithoutStatus), tone: "warn" },
        { label: "offen ohne Prüfdatum", value: de(dq.openWithoutDate), tone: "warn" },
        { label: "offen ohne Prüfer", value: de(dq.openWithoutPruefer), tone: "warn" },
        {
          label: "Status außerhalb der Vokabulare",
          value: de(dq.unmappedStatus),
          tone: dq.unmappedStatus ? "critical" : "ok",
        },
        {
          label: "nicht in offen/zugestimmt/blockiert",
          value: dq.unclassifiedStatuses.map((s) => `${s.status} (${de(s.count)})`).join(", ") || "—",
          tone: "warn",
        },
        {
          label: "Projektnummern",
          value: `${de(dq.totalProjects)} Projekte auf ${de(dq.distinctProjektnummern)} Nummern — eine Nummer bezeichnet ein Programm`,
        },
        { label: "nicht lesbare Datumsangaben", value: de(dq.unparseableDates), tone: dq.unparseableDates ? "warn" : "ok" },
      ],
      [{ label: "Dashboard öffnen", href: "/", kind: "navigate" }],
      "Geprüft über jede geladene Prüfzeile und jedes Projekt.",
    );
  },
};

const contact: Skill = {
  id: "contact",
  example: "Wer ist für ITK zuständig?",
  keywords: ["kontakt", "erreiche", "email", "e-mail", "mail", "anschreiben", "melden", "zuständig", "zustaendig", "verantwortlich", "ansprechpartner"],
  weight: 80,
  needs: "department",
  run(_ctx, e) {
    const department = e.department as string;
    const people = recipientsFor(department as never);
    if (people.length === 0) {
      return {
        intent: "contact",
        headline: `Für ${department} ist in der Hilfsdatei keine Adresse hinterlegt.`,
        facts: [],
        actions: [{ label: `${department} öffnen`, href: gewerkHref(department), kind: "navigate" }],
        // Never a constructed address — see shared/contacts.ts.
        basis: "Aus der Hilfsdatei. Adressen werden nie erzeugt, nur gelesen.",
        confidence: "measured",
      };
    }
    return answer(
      "contact",
      `${department} erreichen Sie über ${people.map((p) => p.name || p.mail).join(", ")}.`,
      people.map((p) => ({ label: p.name || "ohne Namen", value: p.mail })),
      [{ label: `${department} öffnen`, href: gewerkHref(department), kind: "navigate" }],
      "Aus der Hilfsdatei. Adressen werden nie erzeugt, nur gelesen.",
    );
  },
};

const navigate: Skill = {
  id: "navigate",
  example: "Öffne die Karte",
  keywords: ["offne", "öffne", "zeig", "geh zu", "karte", "kacheln", "dashboard", "anmeldung", "historie", "ubersicht", "übersicht"],
  weight: 50,
  run() {
    return answer(
      "navigate",
      "Wohin möchten Sie?",
      [],
      [
        { label: "Dashboard", href: "/", kind: "navigate" },
        { label: "Projekte", href: "/projects", kind: "navigate" },
        { label: "Karte", href: "/projects?view=map", kind: "navigate" },
        { label: "BVB-EEA", href: "/bvb-eea", kind: "navigate" },
        { label: "PSV-ITK", href: "/psv-itk", kind: "navigate" },
        { label: "Projektanmeldung", href: "/anmeldung", kind: "navigate" },
        { label: "Änderungshistorie", href: "/audit", kind: "navigate" },
      ],
      "Alle Routen dieser Anwendung.",
    );
  },
};

const portfolio: Skill = {
  id: "portfolio",
  example: "Wie steht das Portfolio insgesamt?",
  keywords: ["portfolio", "insgesamt", "gesamt", "uberblick", "überblick", "zusammenfassung", "wie stehen wir", "bilanz"],
  weight: 65,
  run(ctx) {
    const standings = gewerkStandings(ctx.projects, DEPARTMENT_LIST, ctx.today);
    const required = standings.reduce((a, s) => a + s.required, 0);
    const open = standings.reduce((a, s) => a + s.open, 0);
    const approved = standings.reduce((a, s) => a + s.approved, 0);
    const blockedTotal = standings.reduce((a, s) => a + s.blocked, 0);
    const other = standings.reduce((a, s) => a + s.other, 0);
    const noApproval = standings.filter((s) => s.required > 0 && s.approved === 0);
    return answer(
      "portfolio",
      `${de(required)} erforderliche Prüfungen über ${de(ctx.projects.length)} Projekte: ${de(approved)} zugestimmt, ${de(open)} offen, ${de(blockedTotal)} blockiert.`,
      [
        { label: "erforderlich", value: de(required) },
        { label: "zugestimmt", value: de(approved), tone: "ok" },
        { label: "offen", value: de(open), tone: "warn" },
        { label: "blockiert", value: de(blockedTotal), tone: blockedTotal ? "critical" : "ok" },
        { label: "sonstiger Abschluss", value: de(other) },
        ...(noApproval.length > 0
          ? [
              {
                label: "Gewerke ohne jede Zustimmung",
                value: noApproval.map((s) => s.department).join(", "),
                tone: "critical" as const,
              },
            ]
          : []),
      ],
      [{ label: "Dashboard öffnen", href: "/", kind: "navigate" }],
      "Summiert über alle 14 Gewerke, ohne „nicht erforderlich“.",
    );
  },
};

export const SKILLS: readonly Skill[] = [
  mostCritical,
  findProject,
  blocked,
  contact,
  overdue,
  unassigned,
  recentChanges,
  aging,
  workload,
  quality,
  portfolio,
  gewerkStatus,
  stationInfo,
  navigate,
];

/** What the assistant offers when it did not understand. Built from the skills. */
export function helpAnswer(): AgentAnswer {
  return {
    intent: "help",
    headline: "Das habe ich nicht verstanden. Fragen, die ich beantworten kann:",
    facts: SKILLS.map((s) => ({ label: s.id, value: s.example })),
    actions: [],
    basis: "Jede Antwort wird aus den geladenen Daten berechnet — nichts wird geschätzt.",
    confidence: "unknown",
  };
}
