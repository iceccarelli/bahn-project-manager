import { useEffect, useMemo, useState } from "react";
import { useReveal } from "@/hooks/useReveal";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  History, Search, Trash2, FilePlus2, PencilLine, ClipboardCheck, FileDown, Send,
  AlertOctagon, Undo2, CornerUpLeft,
} from "lucide-react";
import { useAuditLog } from "@/hooks/useDataQuery";
import { useTableStream } from "@/hooks/useTableStream";
import { useAuditUndo } from "@/hooks/useAuditUndo";
import { auditTone, type AuditTone } from "@shared/audit-actions";
import {
  CORRECTION_WINDOW_MINUTES,
  markCorrections,
  SEVERITY_LABEL,
  describeChange,
  type Severity,
} from "@shared/audit-entry";

/**
 * Änderungshistorie.
 *
 * This page used to be a placeholder: a centred icon and a paragraph reading
 * "Alle Bearbeitungen in dieser Sitzung werden hier protokolliert." It never
 * called useAuditLog(). Every edit *was* being written — action, details with
 * the old and new value, user and ISO timestamp — and nothing ever read them
 * back. The empty state looked deliberate, which is why it survived: the page
 * did not appear broken, it appeared quiet.
 */

/**
 * Icon and tone per action.
 *
 * This was a chain of regexes over the action text, so a new kind of entry fell
 * through to the default and rendered as an anonymous blue row — "PDF erzeugt"
 * and "E-Mail vorbereitet" would both have looked like a field edit. The tone
 * now comes from shared/audit-actions.ts, where `Record<AuditAction, AuditTone>`
 * makes an unclassified action a compile error, and where the two phrases
 * written before that vocabulary existed are mapped explicitly so an existing
 * local trail keeps rendering correctly.
 */
const TONE_STYLE: Record<AuditTone, { Icon: typeof PencilLine; tone: string }> = {
  delete: { Icon: Trash2, tone: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
  create: {
    Icon: FilePlus2,
    tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  },
  review: {
    Icon: ClipboardCheck,
    tone: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
  },
  document: {
    Icon: FileDown,
    tone: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  },
  message: {
    Icon: Send,
    tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  },
  update: {
    Icon: PencilLine,
    tone: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  },
};

function actionStyle(action: string) {
  return TONE_STYLE[auditTone(action)];
}

const dateFmt = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit", month: "2-digit", year: "numeric",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});

function formatStamp(iso: string): string {
  const d = new Date(iso);
  // Never render "Invalid Date" at the user: show what was stored instead.
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

const SEVERITY_STYLE: Record<Severity, string> = {
  kritisch: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  wichtig: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  routine: "bg-muted text-muted-foreground",
};

/** How far back the page looks. "Alles" is the honest default for an audit. */
const WINDOWS: ReadonlyArray<{ key: string; label: string; hours: number | null }> = [
  { key: "24h", label: "24 Stunden", hours: 24 },
  { key: "7d", label: "7 Tage", hours: 24 * 7 },
  { key: "30d", label: "30 Tage", hours: 24 * 30 },
  { key: "all", label: "Alles", hours: null },
];

export default function AuditLogPage() {
  const { data: entries, isLoading } = useAuditLog();
  const streamRef = useTableStream();
  /* The page arrives a section at a time. Decoration only —
     see client/src/lib/motion.ts. */
  const revealRef = useReveal(null);
  const undo = useAuditUndo();
  const [query, setQuery] = useState("");
  const [onlyCritical, setOnlyCritical] = useState(false);
  const [hideCorrected, setHideCorrected] = useState(true);
  const [windowKey, setWindowKey] = useState("all");

  /*
   * A ticking clock, on purpose.
   *
   * Whether an entry is still inside the correction window is a function of the
   * current time, so the undo button has to disappear on its own. Recomputing
   * once a minute is enough for a ten-minute window and costs nothing; deriving
   * it inside the render from Date.now() would make the page classify
   * differently on every unrelated re-render.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const verdicts = useMemo(
    () => markCorrections(entries ?? [], now, CORRECTION_WINDOW_MINUTES),
    [entries, now],
  );

  const cutoff = useMemo(() => {
    const w = WINDOWS.find((x) => x.key === windowKey);
    return w?.hours == null ? null : now - w.hours * 3_600_000;
  }, [windowKey, now]);

  const filtered = useMemo(() => {
    const all = entries ?? [];
    const q = query.trim().toLowerCase();
    return all.filter((e) => {
      const v = verdicts.get(e.id);
      if (cutoff !== null && Date.parse(e.timestamp) < cutoff) return false;
      if (onlyCritical && v?.severity !== "kritisch") return false;
      // A change that was corrected inside the window is one person fixing
      // themselves. It stays in the record; it just does not lead the page.
      if (hideCorrected && v?.superseded) return false;
      if (!q) return true;
      return `${e.action} ${e.details} ${e.user} ${describeChange(e.meta)}`
        .toLowerCase()
        .includes(q);
    });
  }, [entries, query, verdicts, onlyCritical, hideCorrected, cutoff]);

  const total = entries?.length ?? 0;
  const criticalCount = useMemo(
    () => (entries ?? []).filter((e) => verdicts.get(e.id)?.severity === "kritisch").length,
    [entries, verdicts],
  );
  const correctedCount = useMemo(
    () => (entries ?? []).filter((e) => verdicts.get(e.id)?.superseded).length,
    [entries, verdicts],
  );

  return (
    <div ref={revealRef} className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Änderungshistorie</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Protokoll aller Änderungen an Projekten und Prüfungen
          </p>
        </div>
        <div className="relative w-full sm:w-80">
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Änderungshistorie durchsuchen"
            placeholder="Aktion, Feld oder Person …"
            className="h-10 pl-9"
          />
        </div>
      </header>

      {/*
        The controls a reader actually needs on a change log.

        "Nur kritische" is the one that matters: an approval being withdrawn and
        a Prüfer's name being filled in used to render as identical rows, so
        finding the first meant reading all of the second.
      */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={onlyCritical ? "default" : "outline"}
          aria-pressed={onlyCritical}
          onClick={() => setOnlyCritical((v) => !v)}
          className="h-9 gap-2"
        >
          <AlertOctagon className="h-4 w-4" aria-hidden="true" />
          Nur kritische
          <span className="rounded-full bg-black/10 px-1.5 text-2xs font-bold dark:bg-white/20">
            {criticalCount}
          </span>
        </Button>

        <Button
          size="sm"
          variant={hideCorrected ? "default" : "outline"}
          aria-pressed={hideCorrected}
          onClick={() => setHideCorrected((v) => !v)}
          className="h-9 gap-2"
          title={`Änderungen, die innerhalb von ${CORRECTION_WINDOW_MINUTES} Minuten erneut geändert wurden`}
        >
          <CornerUpLeft className="h-4 w-4" aria-hidden="true" />
          Korrekturen ausblenden
          <span className="rounded-full bg-black/10 px-1.5 text-2xs font-bold dark:bg-white/20">
            {correctedCount}
          </span>
        </Button>

        {/* A <fieldset>, not a div with role="group": it is the element the
            grouping role exists to describe, and the legend names it for a
            screen reader without adding a visible heading. */}
        <fieldset className="ml-auto flex items-center gap-1 rounded-lg bg-muted p-1">
          <legend className="sr-only">Zeitraum</legend>
          {WINDOWS.map((w) => (
            <Button
              key={w.key}
              size="sm"
              variant={windowKey === w.key ? "secondary" : "ghost"}
              aria-pressed={windowKey === w.key}
              onClick={() => setWindowKey(w.key)}
              className="h-8 px-3 text-2xs"
            >
              {w.label}
            </Button>
          ))}
        </fieldset>
      </div>

      {/* <output> carries an implicit role=status, so the count is announced
          when the filter changes without an explicit ARIA role. */}
      <output className="block text-xs text-muted-foreground">
        {isLoading
          ? "wird geladen …"
          : query
            ? `${filtered.length} von ${total} Einträgen`
            : `${total} ${total === 1 ? "Eintrag" : "Einträge"}`}
      </output>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-20">
            <div className="flex flex-col items-center justify-center space-y-4 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <History className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-semibold">
                  {total === 0 ? "Noch keine Änderungen" : "Kein Treffer"}
                </h2>
                <p className="mx-auto max-w-md text-sm text-muted-foreground">
                  {total === 0
                    ? "Sobald ein Projekt bearbeitet oder eine Prüfung geändert wird, erscheint der Vorgang hier."
                    : `Kein Eintrag enthält „${query}".`}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">
                Änderungshistorie — Zeitpunkt, Person, Aktion, Schwere und Details je Vorgang
              </caption>
              <thead>
                <tr className="border-b bg-muted/40 text-2xs uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="px-4 py-2.5 text-left font-bold">Zeitpunkt</th>
                  <th scope="col" className="px-4 py-2.5 text-left font-bold">Person</th>
                  <th scope="col" className="px-4 py-2.5 text-left font-bold">Aktion</th>
                  <th scope="col" className="px-4 py-2.5 text-left font-bold">Schwere</th>
                  <th scope="col" className="px-4 py-2.5 text-left font-bold">Details</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-bold">
                    <span className="sr-only">Rückgängig</span>
                  </th>
                </tr>
              </thead>
              <tbody ref={streamRef}>
                {filtered.map((e) => {
                  const { Icon, tone } = actionStyle(e.action);
                  const toneName = auditTone(e.action);
                  const v = verdicts.get(e.id);
                  const severity: Severity = v?.severity ?? "routine";
                  const structured = describeChange(e.meta);
                  return (
                    <tr
                      key={e.id}
                      // Machine-readable so the smoke suite can assert that
                      // every logged action is a known one with its own tone,
                      // rather than inferring it from a badge colour.
                      data-audit-action={e.action}
                      data-audit-tone={toneName}
                      data-audit-severity={severity}
                      data-audit-superseded={v?.superseded ? "true" : "false"}
                      className={`border-b border-border/60 align-top hover:bg-muted/30 ${
                        severity === "kritisch" ? "bg-red-50/60 dark:bg-red-950/20" : ""
                      }`}
                    >
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-2xs text-muted-foreground">
                        {formatStamp(e.timestamp)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs font-medium">{e.user}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-2xs font-medium ${tone}`}
                        >
                          <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
                          {e.action}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-2xs font-semibold ${SEVERITY_STYLE[severity]}`}
                        >
                          {SEVERITY_LABEL[severity]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs leading-snug">
                        {/*
                          The structured sentence when the entry has one, the
                          stored prose when it does not. Entries written before
                          shared/audit-entry.ts carry no meta and keep reading
                          exactly as they did — including the ones that never
                          said which project they changed.
                        */}
                        <span className="block">{structured || e.details}</span>
                        {v?.superseded && (
                          <span className="mt-1 inline-flex items-center gap-1 text-2xs text-muted-foreground">
                            <CornerUpLeft className="h-3 w-3" aria-hidden="true" />
                            {v.revertsEarlier
                              ? `innerhalb von ${CORRECTION_WINDOW_MINUTES} Minuten zurückgesetzt`
                              : `innerhalb von ${CORRECTION_WINDOW_MINUTES} Minuten korrigiert`}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {v?.undoable && e.meta?.field && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => undo(e)}
                            className="h-8 gap-1.5 text-2xs"
                            aria-label={`Änderung zurücknehmen: ${structured || e.details}`}
                          >
                            <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                            Rückgängig
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
