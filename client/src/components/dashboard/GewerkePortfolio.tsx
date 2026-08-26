/**
 * The fourteen Gewerke, ranked by what needs attention — and playing.
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
 * The chain, and why it now runs by default
 * ---------------------------------------------------------------------------
 * Rotation used to be opt-in, on the argument that content moving while it is
 * read is hostile at a desk. That argument is still true, and it is answered
 * here rather than avoided: the chain stops dead the instant a pointer or the
 * keyboard enters the panel, it never starts at all under
 * prefers-reduced-motion (where all fourteen are simply shown at once), and a
 * permanent pause control sits in the header — WCAG 2.2.2, which asks for a
 * mechanism to pause, not for the movement never to begin.
 *
 * What the chain buys is that fourteen Gewerke get a turn in a frame that has
 * room for four. The alternative — four forever, ten never — is not neutral.
 *
 * ---------------------------------------------------------------------------
 * The reel: what a card plays when you look at it
 * ---------------------------------------------------------------------------
 * Hovering or focusing a card replaces its figures with that Gewerk's latest
 * Einträge, one at a time: the session's own Änderungshistorie first, then the
 * most recently dated Prüfzeilen on file. Both are records; neither is
 * invented; each frame says which it is and what it is dated, because
 * "somebody changed this ten minutes ago" and "this review is dated last
 * April" must never look alike. shared/gewerk-reel.ts is where that is built,
 * and it is built from the same projects array the standings are counted from,
 * so the card and its reel cannot disagree.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Info, Pause, Play } from "lucide-react";
import { gewerkHref } from "@shared/search-index";
import { RISK_WEIGHTS, type GewerkStanding, type PortfolioProject } from "@shared/portfolio-metrics";
import { buildReel, type ReelAuditEntry, type ReelEntry } from "@shared/gewerk-reel";
import { TONE_APPEARANCE } from "@shared/status-appearance";

/** How long one card stays in frame before the chain advances. */
const ROTATE_MS = 5000;
/** How long one Eintrag stays on screen while a card is being read. */
const ENTRY_MS = 2200;
/** How many cards the strip shows at once on a wide screen. */
const WINDOW = 4;
/** How many Einträge a reel plays. Small: a reel nobody finishes is a list. */
const REEL_LIMIT = 6;

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

function EntryBody({ entry }: { entry: ReelEntry }) {
  return (
    <>
      {/* Wrapping, not truncating: at four cards across a Dashboard column the
          badge and the date together are wider than the card, and a clipped
          date ("02.06.202") is worse than a date on its own line. */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span
          className={`rounded px-1.5 py-0.5 text-2xs font-semibold ${
            entry.source === "historie"
              ? "bg-primary/10 text-primary"
              : (TONE_APPEARANCE[entry.tone ?? "neutral"]?.badge ?? "")
          }`}
        >
          {entry.source === "historie" ? "Änderung" : "Bestand"}
        </span>
        <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">{entry.whenLabel}</span>
      </div>
      <p className="mt-1.5 line-clamp-2 text-sm font-semibold leading-snug">{entry.what}</p>
      <p className="mt-0.5 line-clamp-2 text-2xs text-muted-foreground">{entry.where}</p>
    </>
  );
}

/**
 * The player.
 *
 * Absolutely positioned over the card's figures, so nothing below it moves:
 * a panel that grew on hover would push the next row of cards down and take
 * the card out from under the pointer that opened it.
 *
 * Under reduced motion there are no frames — every entry is listed at once.
 * Nothing is ever hidden from a reader who asked us to stop moving things.
 */
function Reel({
  department,
  entries,
  frame,
  reduced,
}: {
  department: string;
  entries: readonly ReelEntry[];
  frame: number;
  reduced: boolean;
}) {
  return (
    <div
      data-reel={department}
      data-reel-count={entries.length}
      data-reel-frame={entries.length === 0 ? -1 : frame}
      className="absolute inset-0 z-10 flex flex-col overflow-hidden rounded-xl border-2 border-primary/40 bg-card p-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-bold">{department}</span>
        <span className="shrink-0 text-2xs text-muted-foreground">
          {entries.length > 0 ? `letzte ${entries.length}` : "Verlauf"}
        </span>
      </div>

      {entries.length === 0 ? (
        /* Stated, not blank: a Gewerk can genuinely have no dated row and no
           change on record, and a reader must be told that rather than shown
           an empty box that reads like a loading failure. */
        <p className="mt-3 text-2xs leading-snug text-muted-foreground">
          Keine datierten Prüfzeilen und keine Änderungen in dieser Sitzung. Sobald hier jemand
          etwas ändert, läuft es an dieser Stelle.
        </p>
      ) : reduced ? (
        <ul className="mt-2 min-h-0 flex-1 space-y-2 overflow-hidden">
          {entries.map((e) => (
            <li key={e.id} data-reel-entry data-reel-source={e.source}>
              <EntryBody entry={e} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="relative mt-2 min-h-0 flex-1">
          {entries.map((e, i) => (
            <div
              key={e.id}
              data-reel-entry
              data-reel-source={e.source}
              aria-hidden={i === frame ? undefined : "true"}
              className="absolute inset-0 transition-opacity duration-500"
              style={{
                opacity: i === frame ? 1 : 0,
                pointerEvents: i === frame ? undefined : "none",
              }}
            >
              <EntryBody entry={e} />
            </div>
          ))}
        </div>
      )}

      {entries.length > 1 && !reduced && (
        <div className="mt-2 flex shrink-0 gap-1" aria-hidden="true">
          {entries.map((e, i) => (
            <span
              key={e.id}
              className={`h-1 flex-1 rounded-full ${i === frame ? "bg-primary" : "bg-muted"}`}
            />
          ))}
        </div>
      )}

      {/* The same entries, in one place, for a reader who is listening rather
          than watching. A reel that only exists as a sequence of fades is a
          reel a screen reader gets as an unannounced stream of noise. */}
      {!reduced && entries.length > 0 && (
        <ul className="sr-only">
          {entries.map((e) => (
            <li key={`sr-${e.id}`}>
              {e.source === "historie" ? "Änderung" : "Bestand"} · {e.whenLabel} · {e.what} ·{" "}
              {e.where}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StandingCard({
  standing,
  onOpen,
  onRead,
  rank,
  reel,
  frame,
  reduced,
  playing,
}: {
  standing: GewerkStanding;
  onOpen: () => void;
  onRead: (department: string | null) => void;
  rank: number;
  reel: readonly ReelEntry[];
  frame: number;
  reduced: boolean;
  playing: boolean;
}) {
  const noApprovals = standing.required > 0 && standing.approved === 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => onRead(standing.department)}
      onMouseLeave={() => onRead(null)}
      onFocus={() => onRead(standing.department)}
      onBlur={() => onRead(null)}
      data-gewerk={standing.department}
      data-reel-open={playing ? "true" : undefined}
      aria-label={`${standing.department} öffnen — ${standing.required} Prüfungen, ${standing.open} offen, ${standing.blocked} blockiert`}
      className="relative flex h-full w-full flex-col overflow-hidden rounded-xl border-2 border-border bg-card p-4 text-left transition-all hover:border-primary/40 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {/*
        `invisible`, not "covered by an opaque panel".

        The reel sits on top of these figures, and a panel that merely paints
        over them leaves them in the layout: the UI audit reads "814" and
        "02.06.2026" as 693px² of text on text, and it is right to — a screen
        reader would announce both, and a fractional-opacity theme would show
        both. visibility:hidden takes them out of the painting and out of the
        accessibility tree while keeping every box exactly where it was, so the
        card cannot change size when it starts playing.
      */}
      <div className={`flex flex-1 flex-col gap-3 ${playing ? "invisible" : ""}`}>
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
      </div>

      {playing && (
        <Reel department={standing.department} entries={reel} frame={frame} reduced={reduced} />
      )}
    </button>
  );
}

export function GewerkePortfolio({
  standings,
  projects,
  audit,
}: {
  standings: readonly GewerkStanding[];
  projects: readonly PortfolioProject[];
  audit: readonly ReelAuditEntry[];
}) {
  const [, setLocation] = useLocation();
  const [halted, setHalted] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [offset, setOffset] = useState(0);
  const [reading, setReading] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  const ranked = useMemo(
    () => [...standings].sort((a, b) => b.riskScore - a.riskScore || b.open - a.open),
    [standings],
  );

  const reduced =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** The chain runs unless something is reading it, or somebody stopped it. */
  const chaining = !halted && !showAll && !reduced && reading === null && ranked.length > WINDOW;

  useEffect(() => {
    if (!chaining) return;
    const t = setInterval(() => setOffset((o) => (o + 1) % ranked.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [chaining, ranked.length]);

  /*
   * The reel is built for one department at a time, on demand.
   *
   * Building all fourteen up front is a scan of 18,172 review rows fourteen
   * times over on every Dashboard mount, for cards nobody may hover. One at a
   * time is one scan, when it is asked for, and it is memoised so a re-render
   * mid-hover does not repeat it.
   */
  const reel = useMemo(
    () => (reading === null ? [] : buildReel(projects, audit, reading, REEL_LIMIT)),
    [reading, projects, audit],
  );

  /**
   * A new card starts its reel at the beginning, not wherever the last one got
   * to. Done here rather than in an effect on `reading`: an effect would run
   * after a render that had already painted the new card at the old card's
   * frame index — one frame of the wrong entry, on every hover.
   */
  const readCard = (department: string | null) => {
    setReading(department);
    setFrame(0);
  };

  useEffect(() => {
    if (reading === null || reduced || reel.length <= 1) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % reel.length), ENTRY_MS);
    return () => clearInterval(t);
  }, [reading, reduced, reel.length]);

  const windowed = !showAll && !reduced && ranked.length > WINDOW;

  const shown = useMemo(() => {
    if (!windowed) return ranked;
    return Array.from(
      { length: WINDOW },
      (_, i) => ranked[(offset + i) % ranked.length] as GewerkStanding,
    );
  }, [ranked, windowed, offset]);

  const step = (delta: number) => setOffset((o) => (o + delta + ranked.length) % ranked.length);

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold">Gewerke-Portfolio — alle {ranked.length}</h2>
            <p className="mt-0.5 text-2xs text-muted-foreground">
              Sortiert nach Handlungsdruck · blockiert ×{RISK_WEIGHTS.blocked} + überfällig ×
              {RISK_WEIGHTS.overdue} + ohne Prüfer ×{RISK_WEIGHTS.unassigned}. Eine Rangfolge, keine
              Messung. Zeigen Sie auf eine Karte — sie spielt die letzten Einträge dieses Gewerks.
            </p>
          </div>

          <div className="ml-auto flex items-center gap-1">
            {windowed && (
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
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={halted ? "Kette fortsetzen" : "Kette anhalten"}
                  aria-pressed={halted}
                  onClick={() => setHalted((v) => !v)}
                  className="h-8 gap-1.5 px-2 text-2xs"
                >
                  {halted ? (
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  Kette
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant={showAll ? "default" : "outline"}
              aria-pressed={showAll}
              onClick={() => {
                setShowAll((v) => !v);
                setOffset(0);
              }}
              className="h-8 gap-2 text-2xs"
              title="Alle vierzehn Gewerke gleichzeitig, ohne Wechsel"
            >
              Alle {ranked.length} zeigen
            </Button>
          </div>
        </div>

        {reduced && (
          <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
            Ihr System bevorzugt reduzierte Bewegung — alle {ranked.length} Gewerke stehen
            gleichzeitig, die Einträge einer Karte werden vollständig aufgelistet.
          </p>
        )}

        {/*
          Reading stops the chain, whether the reader arrived with a pointer or
          with the keyboard: a card that rotates away under a pointer is a card
          whose reel the reader never finishes, and hover alone never fires for
          somebody tabbing through.
        */}
        <div
          ref={panelRef}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {shown.map((standing) => (
            <StandingCard
              key={standing.department}
              standing={standing}
              rank={ranked.indexOf(standing) + 1}
              reel={reading === standing.department ? reel : []}
              frame={frame}
              reduced={reduced}
              playing={reading === standing.department}
              onRead={readCard}
              onOpen={() => setLocation(gewerkHref(standing.department))}
            />
          ))}
        </div>

        {windowed && (
          <output className="block text-2xs text-muted-foreground">
            {offset + 1}–{Math.min(offset + WINDOW, offset + shown.length)} von {ranked.length}
            {reading !== null
              ? ` · pausiert — ${reading}`
              : halted
                ? " · angehalten"
                : ` · wechselt alle ${ROTATE_MS / 1000} Sekunden`}
          </output>
        )}
      </CardContent>
    </Card>
  );
}

export default GewerkePortfolio;
