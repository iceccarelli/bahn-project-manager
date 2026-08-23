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
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
 * How tall a value stands.
 *
 * ---------------------------------------------------------------------------
 * Why the first two attempts were invisible, and it was never the number
 * ---------------------------------------------------------------------------
 * 56px, then 104px, and the panel still read flat. Measured in the browser,
 * the reason was not the height at all:
 *
 *     button.relief-cell  transform-style: preserve-3d
 *     td                  transform-style: FLAT
 *     tr                  transform-style: FLAT
 *     tbody               transform-style: FLAT
 *
 * The grid was an HTML `<table>`, and table boxes — row groups, rows, cells —
 * cannot establish a 3D rendering context. Every `translateZ` was flattened
 * back into the plane at the `<td>` boundary before it ever reached the
 * screen. What looked like depth was the drop shadow and the rotateZ shifting
 * columns vertically; the buildings had no height at any setting.
 *
 * The relief is therefore a CSS grid of direct children now, with nothing
 * between the stage and a tile that can flatten it. `Flach` still renders a
 * real `<table>`, which is where a table belongs: it is the view with no
 * spatial encoding to lose.
 *
 * ---------------------------------------------------------------------------
 * The curve
 * ---------------------------------------------------------------------------
 * A linear scale puts EEA's 583 approvals seven times higher than its 82 open
 * and leaves eleven Gewerke as a smear along the floor. A square root is the
 * opposite problem: it compresses 583-against-82 to 2.7×, which is the flat
 * look this panel kept having even once the 3D worked.
 *
 * 0.72 sits between them — 583 : 89 : 4 becomes 160px : 42px : 8px, a skyline
 * with towers and low-rise instead of either a spike or a plateau. Any value
 * above zero gets at least an 8px plinth so "one" is visibly not "none", and
 * zero stays flat on the ground, which is the one thing height here must say
 * plainly.
 *
 * 160px and not more, and the ceiling is set by occlusion rather than taste.
 * At the default 44° tilt a tower rises 160 × sin(44°) ≈ 111px on screen while
 * consecutive rows sit 56 × cos(44°) ≈ 40px apart, so the tallest building
 * reaches back over about two and a half rows. Rows are sorted with the
 * biggest Gewerk farthest away, so those towers stand at the back where there
 * is nothing behind them to hide. Raising the ceiling further would start
 * covering numbers, and a number this panel hides is a number it did not
 * report — which is what „Flach" exists to guarantee it never does.
 */
export const MAX_LIFT_PX = 160;
const LIFT_EXPONENT = 0.72;
const MIN_LIFT_PX = 8;

function lift(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(MIN_LIFT_PX, Math.round((value / max) ** LIFT_EXPONENT * MAX_LIFT_PX));
}

/** Where the camera starts, and what "Ansicht zurücksetzen" returns to. */
/*
 * 44°, not 52°, and −18°, not −24°.
 *
 * The two angles trade against each other and the trade is the whole layout:
 * rows spread down the screen by pitch × cos(tilt), and a building rises by
 * lift × sin(tilt). A steeper tilt makes the towers taller AND squeezes the
 * rows together, which is how the first working version ended up with three
 * Gewerke's numbers on top of each other. Backing off to 44° spreads the rows
 * by a third more and takes 15% off the rise — the same skyline with air in it.
 *
 * The smaller yaw keeps the grid inside its card: rotateZ walks the whole
 * plane sideways, and at −24° the totals were being clipped off the right edge
 * while the Gewerk names were clipped off the left.
 *
 * And it opens at 0.86 rather than 1. A grid 620px wide and 780px tall,
 * rotated by 18°, needs 620·cos18 + 780·sin18 ≈ 830px of horizontal room — a
 * third more than it occupies as a layout box, because rotateZ swings the
 * corners out and the scroll container clips to the box, not to the paint.
 * Starting slightly zoomed out is what makes the whole skyline visible without
 * reserving three hundred pixels of empty margin that only the extreme yaw
 * settings would ever use. The wheel and the slider still go to 2.4.
 */
const HOME = { tilt: 44, spin: -18, zoom: 0.86 } as const;

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

  /**
   * How much empty room the camera needs around the grid.
   *
   * A 3D transform paints far outside its layout box, and the scroll container
   * clips to the box. Reserving a fixed margin means guessing: too little and
   * the far columns are cut off (they were), too much and the panel is mostly
   * white space at every setting except the extreme ones.
   *
   * So it is derived from the camera instead. rotateZ swings the plane's
   * corners out by half its height times sin(yaw); rotateX lifts a tower by its
   * height times sin(tilt). Both scale with the zoom. Spin the panel further
   * and the reserve grows to match — nothing is ever clipped, and nothing is
   * padding that no setting could use.
   */
  const reserve = useMemo(() => {
    const rad = (deg: number) => (deg * Math.PI) / 180;
    const gridHeight = rows.length * 56;
    const sideways = Math.abs(Math.sin(rad(spin))) * gridHeight * 0.5 * zoom;
    const rise = MAX_LIFT_PX * Math.sin(rad(tilt)) * zoom;
    /*
     * The right wall needs its own allowance, and only on one side.
     *
     * A building's side face is drawn as a box `--relief-lift` wide sitting at
     * `left: 100%` of its roof, so the tallest tower paints up to 160px past
     * the last column before any rotation is applied. Symmetric padding wide
     * enough to hold that would have put the same 160px of nothing on the left,
     * where no wall ever goes. The far column was being sliced off with a
     * hundred pixels of white space opposite it.
     */
    const wall = MAX_LIFT_PX * Math.cos(rad(spin)) * zoom * 0.5;
    /*
     * Tilting squashes the plane: 784px of grid becomes 784·cos(44°) ≈ 564px
     * on screen, and the 220px it gives up is left behind as empty band above
     * and below — dead space the layout still reserves because the box did not
     * shrink with the paint. Pulling the orbit back by half of it each way is
     * the difference between a panel and a panel with a hole in it.
     */
    const squash = gridHeight * (1 - Math.cos(rad(tilt))) * 0.5 * zoom;
    return {
      left: `${Math.round(sideways) + 16}px`,
      right: `${Math.round(sideways + wall) + 16}px`,
      top: `${Math.round(rise) + 24}px`,
      squash: `${Math.round(squash)}px`,
    };
  }, [rows.length, spin, tilt, zoom]);

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

        {/*
          The lane legend lives outside the 3D, and that is not a style choice.
          
          It used to be the grid's header row, at the back of the plane — which
          is exactly where the tallest towers stand, so „offen", „blockiert",
          „sonstige" and „zugestimmt" spent their lives behind a 583-storey
          building. A label that the picture can cover is a label the picture
          does not have. Out here it is flat, always readable, and it doubles as
          the colour key the relief never had.
        */}
        {!flat && (
          <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-2xs">
            {LANES.map((lane) => (
              <li key={lane.key} className="flex items-center gap-1.5" title={lane.help}>
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                  // `hue` is already `var(--relief-open)` — the channels, not a
                  // colour — so it needs wrapping, not unwrapping.
                  style={{ backgroundColor: `rgb(${lane.hue})` }}
                  data-lane-swatch={lane.key}
                />
                <span className="font-semibold">{lane.label}</span>
                <span className="text-muted-foreground">— {lane.help}</span>
              </li>
            ))}
          </ul>
        )}

        <div className={`overflow-x-auto px-2 pb-2 ${expanded ? "h-[75vh] overflow-y-auto" : ""}`}>
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
            className={`relief-stage mx-auto min-w-[760px] rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              flat ? "" : dragging ? "cursor-grabbing" : "cursor-grab"
            }`}
            style={
              flat
                ? undefined
                : ({
                    "--relief-tilt": `${tilt}deg`,
                    "--relief-spin": `${spin}deg`,
                    "--relief-zoom": String(zoom),
                    "--relief-headroom": reserve.top,
                    "--relief-padl": reserve.left,
                    "--relief-padr": reserve.right,
                    "--relief-squash": reserve.squash,
                  } as React.CSSProperties)
            }
            data-flat={flat ? "true" : "false"}
            data-dragging={dragging ? "true" : "false"}
            data-autoturn={!flat && !touched ? "true" : "false"}
          >
            {flat ? (
              /*
                Flat is a real table, and that is the point of it.
                
                A table is the right element for values with no spatial
                encoding — it carries the row/column relationship to a screen
                reader for free, and the caption's promise ("alle Werte auch
                ohne räumliche Darstellung") is literally this view. It is also
                the reason the relief above it does NOT have to be one: table
                boxes cannot hold a 3D context, so a relief built from <td>s is
                a relief with no height. One view per job.
              */
              <table className="relief-flat w-full border-separate border-spacing-1 text-2xs">
                <caption className="sr-only">
                  Erforderliche Prüfungen je Gewerk und Zustand, ohne räumliche Darstellung.
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
                        return (
                          <td key={lane.key} className="p-0">
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
            ) : (
              /*
                The city.
                
                One CSS grid, and every label, tile and total is a DIRECT child
                of it. That is not tidiness — it is the whole fix. `transform-
                style: preserve-3d` has to hold unbroken from the perspective
                origin down to the tile, and any box in between that computes
                to `flat` collapses the subtree into its own plane. Table rows
                and cells are exactly such boxes, by specification, in every
                browser. A grid of direct children has nothing in between.
              */
              <div className="relief-orbit">
                <div
                  className="relief-grid"
                  aria-label="Erforderliche Prüfungen je Gewerk und Zustand, als Relief. Jede Kachel nennt ihr Gewerk, ihren Zustand und ihre Zahl."
                >
                  {rows.map((r) => (
                    <Fragment key={r.department}>
                      {/*
                        The Gewerk total moved into its own label, and the
                        sixth grid column is gone.
                        
                        As a column of its own it sat furthest out along the
                        yaw, which is where rotateZ throws content hardest: 814
                        and 610 were being clipped off the right edge of the
                        card while the Gewerk names were clipped off the left.
                        Beside the name it costs no width, it cannot be thrown
                        anywhere, and it reads the way somebody says it — „EEA,
                        814 Prüfungen".
                      */}
                      <button
                        type="button"
                        data-relief-label={r.department}
                        data-relief-total={r.required}
                        onClick={() => setLocation(gewerkHref(r.department))}
                        className="relief-rowlabel"
                        aria-label={`${r.department}: ${r.required} erforderliche Prüfungen — öffnen`}
                      >
                        <span className="relief-rowname">{r.department}</span>
                        <span className="relief-rowtotal tabular-nums">
                          {r.required.toLocaleString("de-DE")}
                        </span>
                      </button>
                      {LANES.map((lane) => {
                        const v = value(r, lane.key);
                        const height = lift(v, max);
                        return (
                          /*
                            A button, not a div. Every tile is a place you can
                            go: choosing one filters that Gewerk to that state,
                            which is the whole reason to look at the shape.
                            Zero-value tiles are disabled rather than hidden —
                            an empty lane is information, and it is the only
                            thing lying flat on the ground.
                          */
                          <button
                            key={lane.key}
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
                        );
                      })}
                    </Fragment>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default PortfolioRelief;
