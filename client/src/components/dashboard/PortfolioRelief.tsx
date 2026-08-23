/**
 * The portfolio as a relief: 14 Gewerke × 4 Zustände, in three dimensions.
 *
 * ---------------------------------------------------------------------------
 * What this is NOT, and why
 * ---------------------------------------------------------------------------
 * It is not a rotating 3D bar chart. Those are the standard answer to "make it
 * 3D" and they are the wrong one for a board: perspective makes a near bar read
 * larger than an identical far one, the top face hides where a bar actually
 * ends, and a reader comparing two columns is comparing two projections rather
 * than two numbers. A CEO deciding where to send people cannot afford a chart
 * whose error depends on the camera angle.
 *
 * So the depth here carries no quantity that has to be compared by eye. Every
 * cell prints its exact count, position is a fixed grid, colour is a bounded
 * scale, and elevation is a redundant encoding of the same value — it makes the
 * shape of the portfolio visible across a room without being the thing anyone
 * reads a number from. Tilt it, or press "Flach" and it is an ordinary heatmap
 * with the identical numbers. Nothing is learned from the tilt that the flat
 * view withholds.
 *
 * CSS 3D transforms, not WebGL: the bundle already carries 382 kB of charting
 * and 150 kB of mapping, and a third rendering stack for one panel is not a
 * trade worth making. This costs nothing and degrades to the flat grid wherever
 * transforms are unavailable or unwanted.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Box, Grid3x3, Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { gewerkHref } from "@shared/search-index";
import type { GewerkStanding } from "@shared/portfolio-metrics";

type Lane = "open" | "blocked" | "other" | "approved";

const LANES: ReadonlyArray<{ key: Lane; label: string; hue: string; help: string }> = [
  { key: "open", label: "offen", hue: "var(--relief-open)", help: "wartet auf eine Entscheidung" },
  { key: "blocked", label: "blockiert", hue: "var(--relief-blocked)", help: "abgelehnt oder gestoppt" },
  { key: "other", label: "sonstige", hue: "var(--relief-other)", help: "Abschluss außerhalb der drei Zustände" },
  { key: "approved", label: "zugestimmt", hue: "var(--relief-approved)", help: "Zustimmung oder Niederschrift" },
];

/**
 * Where a tile goes when it is chosen.
 *
 * The Gewerk tab for the department, plus the state as a search term — so
 * clicking the red block on the EEA row lands on BVB-EEA filtered to the
 * rejected rows, which is the question the shape provoked.
 */
function laneHref(department: string, lane: Lane): string {
  const base = gewerkHref(department);
  const term =
    lane === "open" ? "offen" : lane === "blocked" ? "abgelehnt" : lane === "approved" ? "Zustimmung erteilt" : "";
  if (!term) return base;
  return `${base}${base.includes("?") ? "&" : "?"}q=${encodeURIComponent(term)}`;
}

/**
 * Elevation in px.
 *
 * Square-root, so one huge cell does not flatten the rest: EEA's 583 approvals
 * are 4.4× BS's 134 and would be 4.4× the height on a linear scale, leaving
 * eleven Gewerke as a uniform smear along the floor.
 *
 * 56px was a hill. 104px is a mountain range: at the default 52° tilt that is
 * about 82px of apparent rise, roughly two and a half tile heights, which is
 * where a ridgeline starts reading as terrain rather than as a slightly raised
 * table. It is bounded rather than free precisely because a taller column
 * would occlude the row behind it, and a number this panel hides is a number
 * it has failed to report.
 */
export const MAX_LIFT_PX = 104;

function lift(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.round(Math.sqrt(value / max) * MAX_LIFT_PX);
}

/** Where the camera starts, and what "Ansicht zurücksetzen" returns to. */
const HOME = { tilt: 52, spin: -24, zoom: 1 } as const;

/*
 * The camera limits, at module scope.
 *
 * Defined inside the component they were a new function identity on every
 * render, so every callback that used one had to list it as a dependency and be
 * rebuilt each frame — during a drag, which is the one moment that must not
 * allocate. They are pure functions of a number and belong here.
 *
 * The tilt stops at 78° rather than 90°: past that the tiles are edge-on and
 * the numbers printed on them disappear, which is the one thing this panel
 * promises never to happen.
 */
const clampTilt = (v: number) => Math.min(78, Math.max(0, v));
const clampSpin = (v: number) => Math.min(60, Math.max(-60, v));
const clampZoom = (v: number) => Math.min(2.4, Math.max(0.6, v));

export function PortfolioRelief({ standings }: { standings: readonly GewerkStanding[] }) {
  const [, setLocation] = useLocation();
  const [flat, setFlat] = useState(false);
  const [tilt, setTilt] = useState<number>(HOME.tilt);
  const [spin, setSpin] = useState<number>(HOME.spin);
  const [zoom, setZoom] = useState<number>(HOME.zoom);
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  /*
   * The panel turns by itself until somebody takes the wheel.
   *
   * `touched` latches on the first drag, key press or slider move and never
   * un-latches on its own — a camera that resumes drifting after a reader
   * positioned it by hand is fighting them. "Ansicht zurücksetzen" is the one
   * way back, because that button already means "give me the default view".
   */
  const [touched, setTouched] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; tilt: number; spin: number; active: boolean } | null>(
    null,
  );
  /** Set when a drag ends, so the click it would otherwise produce is dropped. */
  const swallowClick = useRef(false);

  /*
   * Pointer events, not mouse events.
   *
   * One code path covers mouse, trackpad, pen and touch, and setPointerCapture
   * means a drag that leaves the panel keeps working instead of stopping dead
   * halfway through a rotation — which is the difference between something that
   * feels like an instrument and something that feels broken.
   */
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (flat || e.button !== 0) return;
      // Deliberately NOT capturing here.
      //
      // Capturing on pointerdown retargets the whole pointer sequence to this
      // element, and the browser then never produces a click on the tile that
      // was pressed — so every tile became unclickable the moment the panel
      // learned to rotate. The capture is taken only once the pointer has
      // actually travelled, which is the point where the gesture stops being a
      // click and starts being a drag.
      drag.current = { x: e.clientX, y: e.clientY, tilt, spin, active: false };
    },
    [flat, tilt, spin],
  );

  /** Below this, the gesture is still a click. */
  const DRAG_THRESHOLD = 5;

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!start.active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      start.active = true;
      setDragging(true);
      setTouched(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    // Vertical drag tilts, horizontal drag spins — the mapping a hand expects
    // when it grabs a surface and pushes it away.
    setTilt(clampTilt(start.tilt + dy * 0.35));
    setSpin(clampSpin(start.spin + dx * 0.35));
  }, []);

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    drag.current = null;
    if (!start?.active) return;
    swallowClick.current = true;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  /** A drag that ends over a tile must not also open it. */
  const onClickCapture = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  /*
   * Wheel zoom, non-passive.
   *
   * React attaches wheel listeners passively, so preventDefault() inside a JSX
   * onWheel is ignored and the page scrolls away underneath the zoom. The
   * listener is registered by hand for that one reason.
   */
  useEffect(() => {
    const node = stageRef.current;
    if (!node || flat) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setTouched(true);
      setZoom((z) => clampZoom(z - e.deltaY * 0.0015));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [flat]);

  const reset = useCallback(() => {
    setTilt(HOME.tilt);
    setSpin(HOME.spin);
    setZoom(HOME.zoom);
    // Back to the default view means back to the default behaviour.
    setTouched(false);
  }, []);

  /** Arrow keys orbit, +/- zoom, Home recentres — the whole thing without a mouse. */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (flat) return;
      const step = e.shiftKey ? 10 : 4;
      const map: Record<string, () => void> = {
        ArrowUp: () => setTilt((v) => clampTilt(v - step)),
        ArrowDown: () => setTilt((v) => clampTilt(v + step)),
        ArrowLeft: () => setSpin((v) => clampSpin(v - step)),
        ArrowRight: () => setSpin((v) => clampSpin(v + step)),
        "+": () => setZoom((z) => clampZoom(z + 0.12)),
        "=": () => setZoom((z) => clampZoom(z + 0.12)),
        "-": () => setZoom((z) => clampZoom(z - 0.12)),
        Home: reset,
      };
      const run = map[e.key];
      if (run) {
        e.preventDefault();
        setTouched(true);
        run();
      }
    },
    [flat, reset],
  );

  const rows = useMemo(
    () => [...standings].sort((a, b) => b.required - a.required),
    [standings],
  );
  const max = useMemo(
    () => Math.max(1, ...rows.flatMap((r) => [r.open, r.blocked, r.other, r.approved])),
    [rows],
  );
  const grandTotal = rows.reduce((a, r) => a + r.required, 0);

  const value = (r: GewerkStanding, lane: Lane) =>
    lane === "open" ? r.open : lane === "blocked" ? r.blocked : lane === "other" ? r.other : r.approved;

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold">Portfolio-Relief</h2>
            <p className="mt-0.5 max-w-2xl text-2xs leading-relaxed text-muted-foreground">
              {grandTotal.toLocaleString("de-DE")} erforderliche Prüfungen, nach Gewerk und Zustand.
              Höhe und Farbe zeigen dieselbe Zahl — abgelesen wird sie immer aus der Kachel, nie aus
              der Perspektive.
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <Button
              size="sm"
              variant={flat ? "outline" : "default"}
              aria-pressed={!flat}
              onClick={() => setFlat(false)}
              className="h-8 gap-1.5 text-2xs"
            >
              <Box className="h-3.5 w-3.5" aria-hidden="true" />
              Relief
            </Button>
            <Button
              size="sm"
              variant={flat ? "default" : "outline"}
              aria-pressed={flat}
              onClick={() => setFlat(true)}
              className="h-8 gap-1.5 text-2xs"
            >
              <Grid3x3 className="h-3.5 w-3.5" aria-hidden="true" />
              Flach
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={expanded}
              onClick={() => setExpanded((v) => !v)}
              className="h-8 gap-1.5 text-2xs"
            >
              {expanded ? (
                <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {expanded ? "Verkleinern" : "Vergrößern"}
            </Button>
            {!flat && (
              <Button
                size="sm"
                variant="ghost"
                onClick={reset}
                className="h-8 gap-1.5 text-2xs"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Ansicht zurücksetzen
              </Button>
            )}
          </div>
        </div>

        {!flat && (
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-2xs text-muted-foreground">
              Neigung
              <input
                type="range"
                min={0}
                max={78}
                value={tilt}
                onChange={(e) => {
                  setTouched(true);
                  setTilt(Number(e.target.value));
                }}
                className="h-1 w-32 accent-primary"
                aria-label="Neigung des Reliefs"
              />
            </label>
            <label className="flex items-center gap-2 text-2xs text-muted-foreground">
              Drehung
              <input
                type="range"
                min={-60}
                max={60}
                value={spin}
                onChange={(e) => {
                  setTouched(true);
                  setSpin(Number(e.target.value));
                }}
                className="h-1 w-32 accent-primary"
                aria-label="Drehung des Reliefs"
              />
            </label>
            <label className="flex items-center gap-2 text-2xs text-muted-foreground">
              Zoom
              <input
                type="range"
                min={60}
                max={240}
                value={Math.round(zoom * 100)}
                onChange={(e) => {
                  setTouched(true);
                  setZoom(Number(e.target.value) / 100);
                }}
                className="h-1 w-32 accent-primary"
                aria-label="Zoom des Reliefs"
              />
            </label>
            <span className="text-2xs text-muted-foreground">
              {touched
                ? "Ziehen zum Drehen · Mausrad zum Zoomen · Pfeiltasten, +/−, Pos1 · „Ansicht zurücksetzen“ startet die Eigendrehung neu"
                : "Dreht sich von selbst · anfassen übernimmt die Kamera · Mausrad zum Zoomen · Pfeiltasten, +/−, Pos1"}
            </span>
          </div>
        )}

        <div className={`overflow-x-auto pb-2 ${expanded ? "h-[70vh] overflow-y-auto" : ""}`}>
          {/*
            The stage is the thing you grab. tabIndex + the key handler make the
            same camera reachable without a pointer, and the role/aria-label say
            what it is — a control surface, not decoration.
          */}
          <div
            ref={stageRef}
            role="application"
            aria-label="Portfolio-Relief — ziehen zum Drehen, Mausrad zum Zoomen, Pfeiltasten und Plus/Minus über die Tastatur"
            tabIndex={flat ? -1 : 0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onClickCapture={onClickCapture}
            onKeyDown={onKeyDown}
            className={`relief-stage mx-auto min-w-[640px] rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              flat ? "" : dragging ? "cursor-grabbing" : "cursor-grab"
            }`}
            style={
              flat
                ? undefined
                : ({
                    "--relief-tilt": `${tilt}deg`,
                    "--relief-spin": `${spin}deg`,
                    "--relief-zoom": String(zoom),
                  } as React.CSSProperties)
            }
            data-flat={flat ? "true" : "false"}
            data-dragging={dragging ? "true" : "false"}
            data-autoturn={!flat && !touched ? "true" : "false"}
          >
            {/*
              The orbit is its own element on purpose.
              
              The idle sweep and the reader's own tilt/spin/zoom are two
              transforms of the same object, and stacking both on one node means
              the CSS animation overwrites the inline transform the sliders set.
              Nesting composes them instead: the grid holds the camera the
              reader controls, the wrapper adds the drift, and the drift stops
              by removing one attribute — no per-frame state, no re-render.
            */}
            <div className="relief-orbit">
            <table className="relief-grid w-full border-separate border-spacing-1 text-2xs">
              <caption className="sr-only">
                Erforderliche Prüfungen je Gewerk und Zustand. Die Tabelle enthält alle Werte auch
                ohne räumliche Darstellung.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="w-40 px-2 py-1 text-left font-semibold text-muted-foreground">
                    Gewerk
                  </th>
                  {LANES.map((lane) => (
                    <th
                      key={lane.key}
                      scope="col"
                      title={lane.help}
                      className="px-2 py-1 text-center font-semibold text-muted-foreground"
                    >
                      {lane.label}
                    </th>
                  ))}
                  <th scope="col" className="px-2 py-1 text-right font-semibold text-muted-foreground">
                    gesamt
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.department}>
                    <th scope="row" className="px-2 py-1 text-left font-semibold">
                      <button
                        type="button"
                        onClick={() => setLocation(gewerkHref(r.department))}
                        className="rounded px-1 text-left hover:text-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {r.department}
                      </button>
                    </th>
                    {LANES.map((lane) => {
                      const v = value(r, lane.key);
                      const height = lift(v, max);
                      return (
                        <td key={lane.key} className="p-0">
                          {/*
                            A button, not a div. Every tile is a place you can
                            go: choosing one filters that Gewerk to that state,
                            which is the whole reason to look at the shape in
                            the first place. Zero-value tiles are disabled
                            rather than hidden — an empty lane is information.
                          */}
                          <button
                            type="button"
                            className="relief-cell"
                            data-value={v}
                            data-lane={lane.key}
                            data-department={r.department}
                            disabled={v === 0}
                            title={`${r.department} · ${lane.label}: ${v}`}
                            aria-label={`${r.department}, ${lane.label}: ${v} Prüfungen${v > 0 ? " — öffnen" : ""}`}
                            onClick={() => {
                              if (v === 0) return;
                              setLocation(laneHref(r.department, lane.key));
                            }}
                            style={
                              {
                                "--relief-lift": `${height}px`,
                                "--relief-fill": lane.hue,
                                "--relief-alpha": String(v === 0 ? 0.06 : 0.25 + (v / max) * 0.75),
                              } as React.CSSProperties
                            }
                          >
                            <span className="relief-value tabular-nums">{v}</span>
                          </button>
                        </td>
                      );
                    })}
                    <td className="px-2 py-1 text-right font-semibold tabular-nums">
                      {r.required.toLocaleString("de-DE")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default PortfolioRelief;
