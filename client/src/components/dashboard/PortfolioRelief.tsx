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
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Box, Grid3x3, RotateCcw } from "lucide-react";
import { gewerkHref } from "@shared/search-index";
import type { GewerkStanding } from "@shared/portfolio-metrics";

type Lane = "open" | "blocked" | "other" | "approved";

const LANES: ReadonlyArray<{ key: Lane; label: string; hue: string; help: string }> = [
  { key: "open", label: "offen", hue: "var(--relief-open)", help: "wartet auf eine Entscheidung" },
  { key: "blocked", label: "blockiert", hue: "var(--relief-blocked)", help: "abgelehnt oder gestoppt" },
  { key: "other", label: "sonstige", hue: "var(--relief-other)", help: "Abschluss außerhalb der drei Zustände" },
  { key: "approved", label: "zugestimmt", hue: "var(--relief-approved)", help: "Zustimmung oder Niederschrift" },
];

/** Elevation in px. Square-root so one huge cell does not flatten the rest. */
function lift(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.round(Math.sqrt(value / max) * 56);
}

export function PortfolioRelief({ standings }: { standings: readonly GewerkStanding[] }) {
  const [, setLocation] = useLocation();
  const [flat, setFlat] = useState(false);
  const [tilt, setTilt] = useState(52);
  const [spin, setSpin] = useState(-24);

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
            {!flat && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setTilt(52);
                  setSpin(-24);
                }}
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
                max={70}
                value={tilt}
                onChange={(e) => setTilt(Number(e.target.value))}
                className="h-1 w-32 accent-primary"
                aria-label="Neigung des Reliefs"
              />
            </label>
            <label className="flex items-center gap-2 text-2xs text-muted-foreground">
              Drehung
              <input
                type="range"
                min={-45}
                max={45}
                value={spin}
                onChange={(e) => setSpin(Number(e.target.value))}
                className="h-1 w-32 accent-primary"
                aria-label="Drehung des Reliefs"
              />
            </label>
          </div>
        )}

        <div className="overflow-x-auto pb-2">
          <div
            className="relief-stage mx-auto min-w-[640px]"
            style={
              flat
                ? undefined
                : ({
                    "--relief-tilt": `${tilt}deg`,
                    "--relief-spin": `${spin}deg`,
                  } as React.CSSProperties)
            }
            data-flat={flat ? "true" : "false"}
          >
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
                          <div
                            className="relief-cell"
                            data-value={v}
                            title={`${r.department} · ${lane.label}: ${v}`}
                            style={
                              {
                                "--relief-lift": `${height}px`,
                                "--relief-fill": lane.hue,
                                "--relief-alpha": String(v === 0 ? 0.06 : 0.25 + (v / max) * 0.75),
                              } as React.CSSProperties
                            }
                          >
                            <span className="relief-value tabular-nums">{v}</span>
                          </div>
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
      </CardContent>
    </Card>
  );
}

export default PortfolioRelief;
