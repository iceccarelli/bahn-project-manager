/**
 * The fourteen Gewerke, ranked by what needs attention.
 *
 * What this replaces: eight tiles, seven of which read "1.298". That figure was
 * "projects whose row for this Gewerk carries a recognised status" — a constant
 * for every Gewerk, forever. The real workload is 814 for EEA, 510 for ITK, 100
 * for HFT. Six of the fourteen were not shown at all, and the two with no
 * approvals on record — UM and BIM — were among the six.
 *
 * Ordering is by riskScore, whose weights are printed on the panel rather than
 * buried in a formula. A reader who disagrees with them can see what they are.
 *
 * ---------------------------------------------------------------------------
 * Präsentationsmodus
 * ---------------------------------------------------------------------------
 * The rotation is opt-in, and that is a decision rather than an oversight.
 * Content that moves while it is being read is hostile at a desk: a reader
 * halfway through a number loses it. On a wall display nobody is reading
 * closely and rotation is the only way to show fourteen cards in one frame. So:
 * off by default, one click on, pauses the moment a pointer or the keyboard
 * enters the panel, and never runs at all under prefers-reduced-motion.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Info, Pause, Play } from "lucide-react";
import { gewerkHref } from "@shared/search-index";
import { RISK_WEIGHTS, type GewerkStanding } from "@shared/portfolio-metrics";

const ROTATE_MS = 5000;
/** How many cards the strip shows at once on a wide screen. */
const WINDOW = 4;

function Bar({ standing }: { standing: GewerkStanding }) {
  const total = Math.max(standing.required, 1);
  const seg = (n: number) => `${(n / total) * 100}%`;
  return (
    <div
      className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
      role="img"
      aria-label={`${standing.approved} zugestimmt, ${standing.open} offen, ${standing.blocked} blockiert, ${standing.other} sonstige von ${standing.required}`}
    >
      <span className="bg-emerald-500" style={{ width: seg(standing.approved) }} />
      <span className="bg-amber-500" style={{ width: seg(standing.open) }} />
      <span className="bg-red-600" style={{ width: seg(standing.blocked) }} />
      <span className="bg-zinc-400" style={{ width: seg(standing.other) }} />
    </div>
  );
}

function StandingCard({
  standing,
  onOpen,
  rank,
}: {
  standing: GewerkStanding;
  onOpen: () => void;
  rank: number;
}) {
  const noApprovals = standing.required > 0 && standing.approved === 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-gewerk={standing.department}
      aria-label={`${standing.department} öffnen — ${standing.required} Prüfungen, ${standing.open} offen, ${standing.blocked} blockiert`}
      className="flex h-full w-full flex-col gap-3 rounded-xl border-2 border-border bg-card p-4 text-left transition-all hover:border-primary/40 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <span className="truncate text-sm font-bold">{standing.department}</span>
        <span className="shrink-0 text-2xs font-semibold text-muted-foreground">#{rank}</span>
      </div>

      {/* Stacked, not baseline-aligned: side by side the caption wrapped to two
          lines inside a one-line box and pushed 8px past the card edge. */}
      <div>
        <div className="text-3xl font-bold leading-none tabular-nums">
          {standing.required.toLocaleString("de-DE")}
        </div>
        <p className="mt-1 text-2xs text-muted-foreground">Prüfungen erforderlich</p>
      </div>

      <Bar standing={standing} />

      {/*
        min-w-0 on each pair and truncate on the label.
        
        Without them the label cannot shrink, so in a two-column grid the value
        was pushed past its own column: "89" ended at x=422 while "überfällig"
        began at x=410 — a measured 192px² of text on text, at desktop width, on
        every card.
      */}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-2xs">
        <div className="flex min-w-0 justify-between gap-2">
          <dt className="truncate text-muted-foreground">offen</dt>
          <dd className="shrink-0 font-semibold tabular-nums text-amber-700 dark:text-amber-400">
            {standing.open}
          </dd>
        </div>
        <div className="flex min-w-0 justify-between gap-2">
          <dt className="truncate text-muted-foreground">zugestimmt</dt>
          <dd className="shrink-0 font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
            {standing.approved}
          </dd>
        </div>
        <div className="flex min-w-0 justify-between gap-2">
          <dt className="truncate text-muted-foreground">blockiert</dt>
          <dd className="shrink-0 font-semibold tabular-nums text-red-700 dark:text-red-400">
            {standing.blocked}
          </dd>
        </div>
        <div className="flex min-w-0 justify-between gap-2">
          <dt className="truncate text-muted-foreground">überfällig</dt>
          <dd className="shrink-0 font-semibold tabular-nums">{standing.overdue}</dd>
        </div>
      </dl>

      {/* Stated, not implied: a Gewerk whose vocabulary contains no approval
          state can never show progress, and a reader must be told that rather
          than left to read 0 % as failure. */}
      {noApprovals && (
        <p className="rounded-md bg-amber-50 px-2 py-1 text-2xs leading-snug text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          keine Zustimmung im Bestand — {standing.other} Zeilen tragen einen anderen Abschluss
        </p>
      )}
    </button>
  );
}

export function GewerkePortfolio({ standings }: { standings: readonly GewerkStanding[] }) {
  const [, setLocation] = useLocation();
  const [rotating, setRotating] = useState(false);
  const [offset, setOffset] = useState(0);
  const [paused, setPaused] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const ranked = useMemo(
    () => [...standings].sort((a, b) => b.riskScore - a.riskScore || b.open - a.open),
    [standings],
  );

  const reduced =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (!rotating || paused || reduced || ranked.length <= WINDOW) return;
    const t = setInterval(() => setOffset((o) => (o + 1) % ranked.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [rotating, paused, reduced, ranked.length]);

  const shown = useMemo(() => {
    if (!rotating || ranked.length <= WINDOW) return ranked;
    return Array.from({ length: WINDOW }, (_, i) => ranked[(offset + i) % ranked.length] as GewerkStanding);
  }, [ranked, rotating, offset]);

  const step = (delta: number) =>
    setOffset((o) => (o + delta + ranked.length) % ranked.length);

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold">Gewerke-Portfolio — alle {ranked.length}</h2>
            <p className="mt-0.5 text-2xs text-muted-foreground">
              Sortiert nach Handlungsdruck · blockiert ×{RISK_WEIGHTS.blocked} + überfällig ×
              {RISK_WEIGHTS.overdue} + ohne Prüfer ×{RISK_WEIGHTS.unassigned}. Eine Rangfolge, keine
              Messung.
            </p>
          </div>

          <div className="ml-auto flex items-center gap-1">
            {rotating && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Vorheriges Gewerk"
                  onClick={() => step(-1)}
                  className="h-8 w-8 p-0"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Nächstes Gewerk"
                  onClick={() => step(1)}
                  className="h-8 w-8 p-0"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant={rotating ? "default" : "outline"}
              aria-pressed={rotating}
              onClick={() => {
                setRotating((v) => !v);
                setOffset(0);
              }}
              className="h-8 gap-2 text-2xs"
              title="Für Wandmonitore: zeigt die Gewerke nacheinander"
            >
              {rotating ? (
                <Pause className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Präsentationsmodus
            </Button>
          </div>
        </div>

        {rotating && reduced && (
          <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
            Ihr System bevorzugt reduzierte Bewegung — der Wechsel erfolgt nur über die Pfeile.
          </p>
        )}

        {/*
          Pausing on pointer or focus entry, not just on hover: a keyboard user
          tabbing into a card that then rotates away has lost their place, and
          hover alone never fires for them.
        */}
        <div
          ref={panelRef}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={() => setPaused(false)}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {shown.map((standing) => (
            <StandingCard
              key={standing.department}
              standing={standing}
              rank={ranked.indexOf(standing) + 1}
              onOpen={() => setLocation(gewerkHref(standing.department))}
            />
          ))}
        </div>

        {rotating && (
          <output className="block text-2xs text-muted-foreground">
            {offset + 1}–{Math.min(offset + WINDOW, offset + shown.length)} von {ranked.length}
            {paused ? " · pausiert" : ""}
          </output>
        )}
      </CardContent>
    </Card>
  );
}

export default GewerkePortfolio;
