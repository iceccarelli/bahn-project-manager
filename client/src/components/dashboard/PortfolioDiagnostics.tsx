/**
 * The diagnostics a board asks for once the headline numbers stop moving.
 *
 * Three questions, three panels, every figure derived in
 * shared/portfolio-metrics.ts:
 *
 *   How old is the backlog?  — the median open check is over a year old and 328
 *                              are past a year. A count of "offen" hides that
 *                              completely; a count plus an age does not.
 *   Who is carrying it?      — if five people hold half the open work, the plan
 *                              depends on five calendars.
 *   Can the numbers be       — every other panel rests on these rows. A
 *   trusted?                   dashboard that reports confidently on data it
 *                              has not checked is the expensive kind of wrong.
 */
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, CalendarClock, ShieldCheck, Users } from "lucide-react";
import type { Aging, Concentration, DataQuality } from "@shared/portfolio-metrics";

function Panel({
  title,
  icon: Icon,
  subtitle,
  children,
}: {
  title: string;
  icon: typeof Users;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="h-full">
      <CardContent className="space-y-3 p-5">
        <div className="flex items-start gap-2">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary-strong" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="text-sm font-bold">{title}</h3>
            <p className="text-2xs leading-snug text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: string | number;
  tone?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="min-w-0 truncate text-2xs text-muted-foreground">{label}</span>
      <span className={`shrink-0 text-xs font-bold tabular-nums ${tone ?? ""}`}>
        {typeof value === "number" ? value.toLocaleString("de-DE") : value}
      </span>
    </>
  );
  if (!onClick) {
    return <div className="flex items-baseline justify-between gap-3 py-1">{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="-mx-1 flex w-full items-baseline justify-between gap-3 rounded px-1 py-1 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {body}
    </button>
  );
}

export function PortfolioDiagnostics({
  aging,
  concentration,
  quality,
}: {
  aging: Aging;
  concentration: Concentration;
  quality: DataQuality;
}) {
  const [, setLocation] = useLocation();
  const agedTotal = aging.cohorts.reduce((a, c) => a + c.count, 0);
  const overAYear = aging.cohorts.find((c) => c.key === "365+")?.count ?? 0;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Panel
        title="Alter der offenen Prüfungen"
        icon={CalendarClock}
        subtitle={
          aging.medianAgeDays === null
            ? "Keine der offenen Prüfungen trägt ein Datum."
            : `Median ${aging.medianAgeDays.toLocaleString("de-DE")} Tage seit dem eingetragenen Prüfdatum.`
        }
      >
        <div className="space-y-0.5">
          {aging.cohorts.map((c) => (
            <div key={c.key} className="space-y-0.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-2xs text-muted-foreground">{c.label}</span>
                <span className="text-xs font-bold tabular-nums">
                  {c.count.toLocaleString("de-DE")}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <span
                  className={`block h-full ${c.key === "365+" ? "bg-red-600" : c.key === "181-365" ? "bg-amber-500" : "bg-primary"}`}
                  style={{ width: `${agedTotal > 0 ? (c.count / agedTotal) * 100 : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        <p className="rounded-md bg-muted/60 px-2 py-1.5 text-2xs leading-snug">
          {overAYear.toLocaleString("de-DE")} offene Prüfungen sind älter als ein Jahr.{" "}
          {/* Never quietly excluded: an undated row cannot be aged and saying so
              is the difference between a gap and a wrong answer. */}
          {aging.undatedOpen.toLocaleString("de-DE")} weitere tragen kein Prüfdatum und lassen sich
          nicht altern.
        </p>
      </Panel>

      <Panel
        title="Verteilung der Last"
        icon={Users}
        subtitle={`${concentration.reviewers.length} Prüfer im Bestand · die fünf größten halten ${concentration.topFiveShareOfOpen}% der offenen Prüfungen.`}
      >
        <div>
          {concentration.reviewers.slice(0, 6).map((r) => (
            <Row
              key={r.name}
              label={`${r.name} — ${r.done.toLocaleString("de-DE")} erledigt`}
              value={r.open}
              tone={r.open > 40 ? "text-red-700 dark:text-red-400" : undefined}
              onClick={() => setLocation(`/projects?q=${encodeURIComponent(r.name)}`)}
            />
          ))}
        </div>
        <Row
          label="offen, ohne benannten Prüfer"
          value={concentration.unassignedOpen}
          tone="text-amber-700 dark:text-amber-400"
        />
      </Panel>

      <Panel
        title="Belastbarkeit der Zahlen"
        icon={ShieldCheck}
        subtitle={`${quality.totalReviews.toLocaleString("de-DE")} Prüfzeilen über ${quality.totalProjects.toLocaleString("de-DE")} Projekte.`}
      >
        <div>
          <Row label="Prüfzeilen ohne Status" value={quality.reviewsWithoutStatus} />
          <Row
            label="offen, ohne Prüfdatum"
            value={quality.openWithoutDate}
            tone="text-amber-700 dark:text-amber-400"
          />
          <Row label="offen, ohne Prüfer" value={quality.openWithoutPruefer} />
          <Row label="Projekte ohne Projektnummer" value={quality.withoutProjektnummer} />
          <Row
            label="nicht lesbare Datumsangaben"
            value={quality.unparseableDates}
            tone={quality.unparseableDates > 0 ? "text-amber-700 dark:text-amber-400" : undefined}
          />
          <Row
            label="Status außerhalb der Vokabulare"
            value={quality.unmappedStatus}
            tone={quality.unmappedStatus > 0 ? "text-red-700 dark:text-red-400" : undefined}
          />
        </div>

        {quality.unclassifiedStatuses.length > 0 && (
          <div className="rounded-md bg-amber-50 px-2 py-1.5 dark:bg-amber-950/40">
            <p className="flex items-start gap-1.5 text-2xs leading-snug text-amber-900 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              <span>
                {/* This is why "offen + zugestimmt + blockiert" does not add up
                    to the workload, and saying so beats letting a reader find
                    the gap themselves. */}
                Nicht in offen / zugestimmt / blockiert enthalten:{" "}
                {quality.unclassifiedStatuses
                  .map((s) => `${s.status} (${s.count.toLocaleString("de-DE")})`)
                  .join(", ")}
                .
              </span>
            </p>
          </div>
        )}

        <p className="text-2xs leading-snug text-muted-foreground">
          Eine Projektnummer bezeichnet ein Programm, kein einzelnes Projekt:{" "}
          {quality.totalProjects.toLocaleString("de-DE")} Projekte verteilen sich auf{" "}
          {quality.distinctProjektnummern.toLocaleString("de-DE")} Nummern,{" "}
          {quality.sharedProjektnummern.toLocaleString("de-DE")} davon mehrfach vergeben.
        </p>
      </Panel>
    </div>
  );
}

export default PortfolioDiagnostics;
