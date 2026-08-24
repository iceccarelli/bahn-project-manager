/**
 * A donut with real thickness, and every slice a place you can go.
 *
 * ---------------------------------------------------------------------------
 * How the depth is made
 * ---------------------------------------------------------------------------
 * The chart is drawn once as the top face and again, offset downwards and
 * darkened, as the extruded side — the oldest way there is to give a flat
 * shape a body. The stack sits inside a container tilted on X, so the disc
 * lies on a table rather than facing the reader, and the side becomes visible
 * exactly as it does on a real coin.
 *
 * ---------------------------------------------------------------------------
 * What the tilt is NOT allowed to cost
 * ---------------------------------------------------------------------------
 * Tilting a pie makes near slices look bigger than far ones of the same size.
 * That is the reason this project's relief refuses to encode anything in
 * perspective, and the same rule applies here: nothing is read off the shape.
 * Every slice prints its own count in the list beside the chart, the legend is
 * flat and upright, and the numbers are the deliverable. The tilt is how it
 * looks; the list is what it says.
 *
 * ---------------------------------------------------------------------------
 * Clicking
 * ---------------------------------------------------------------------------
 * A slice is a filter. Choosing one lands on the projects behind it — and
 * because the slice count and the landing set come from one predicate in
 * shared/handlungsbedarf.ts, the number on the slice and the number of cards
 * on the page are the same fact counted two ways rather than two numbers that
 * disagree.
 */
import { useCallback, useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useLocation } from "wouter";
import { toneHref, type ToneCount } from "@shared/handlungsbedarf";
import { toneIsAwaiting } from "@shared/handlungsbedarf";

/** How many copies make the side of the disc. Enough to look solid, few enough to be free. */
const DEPTH_LAYERS = 7;
const LAYER_PX = 3;

export function Pie3D({
  slices,
  height = 380,
  label,
  department,
}: {
  slices: readonly ToneCount[];
  height?: number;
  label: string;
  /**
   * The Gewerk this donut is showing, when it is showing one.
   *
   * It scopes where a slice goes. Without it, a band inside „Status-Verteilung
   * für EEA" would land on every project with an open row in any of fourteen
   * departments — a link that looks right and is wrong by a factor of four.
   */
  department?: string;
}) {
  const [, setLocation] = useLocation();
  const [active, setActive] = useState<string | null>(null);

  const total = useMemo(() => slices.reduce((a, s) => a + s.rows, 0), [slices]);

  const go = useCallback(
    (tone: string) => setLocation(toneHref(tone as never, department)),
    [setLocation, department],
  );

  if (slices.length === 0) return null;

  const layers = Array.from({ length: DEPTH_LAYERS }, (_, i) => i);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      <div className="min-w-0 lg:col-span-3">
        <div className="pie3d" style={{ height }}>
          <div className="pie3d-stack">
            {/*
              The side of the disc: the same geometry, painted below the top
              face and progressively darker. `aria-hidden`, because it carries
              no information a reader has not already been given — it is the
              thickness of a shape, not a value.
            */}
            {layers.map((i) => (
              <div
                key={i}
                aria-hidden="true"
                className="pie3d-layer"
                style={{ transform: `translateZ(${-(i + 1) * LAYER_PX}px)`, opacity: 0.9 }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={slices as ToneCount[]}
                      dataKey="rows"
                      nameKey="label"
                      cx="50%"
                      cy="50%"
                      innerRadius="46%"
                      outerRadius="78%"
                      paddingAngle={2}
                      isAnimationActive={false}
                      stroke="none"
                    >
                      {slices.map((s) => (
                        <Cell key={s.tone} fill={s.hex} fillOpacity={0.55 - i * 0.05} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ))}

            <div className="pie3d-top">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={slices as ToneCount[]}
                    dataKey="rows"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    innerRadius="46%"
                    outerRadius="78%"
                    paddingAngle={2}
                    isAnimationActive={false}
                    onClick={(_, index) => {
                      const slice = slices[index];
                      if (slice) go(slice.tone);
                    }}
                    onMouseEnter={(_, index) => setActive(slices[index]?.tone ?? null)}
                    onMouseLeave={() => setActive(null)}
                    stroke="hsl(var(--card))"
                    strokeWidth={2}
                    className="cursor-pointer"
                  >
                    {slices.map((s) => (
                      <Cell
                        key={s.tone}
                        fill={s.hex}
                        /* Open work is lifted out of the disc and lit; settled
                           work sits flush. The distinction is the one every
                           other status surface in this app already makes. */
                        className={
                          toneIsAwaiting(s.tone)
                            ? "pie3d-slice pie3d-slice-open"
                            : "pie3d-slice"
                        }
                        opacity={active === null || active === s.tone ? 1 : 0.55}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      `${value.toLocaleString("de-DE")} Prüfzeilen`,
                      name,
                    ]}
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/*
        The list is the deliverable, not the disc.
        
        It is upright, unrotated and carries every figure the chart encodes —
        so nothing anyone needs is ever read off a tilted shape, and a reader
        who cannot use the chart at all loses nothing but the picture.
      */}
      <ul className="min-w-0 space-y-1.5 lg:col-span-2" aria-label={label}>
        {slices.map((s) => (
          <li key={s.tone}>
            <button
              type="button"
              data-tone-slice={s.tone}
              data-tone-rows={s.rows}
              data-tone-projects={s.projects}
              data-tone-department={department ?? ""}
              onClick={() => go(s.tone)}
              onMouseEnter={() => setActive(s.tone)}
              onMouseLeave={() => setActive(null)}
              aria-label={`${s.label}: ${s.rows} Prüfzeilen in ${s.projects} Projekten — öffnen`}
              className={`flex w-full items-center gap-2.5 rounded-lg border border-transparent bg-muted/40 px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                active === s.tone ? "border-primary/40 bg-muted" : ""
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-3 w-3 shrink-0 rounded-full ${toneIsAwaiting(s.tone) ? "pulse-open" : ""}`}
                style={{ backgroundColor: s.hex }}
              />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{s.label}</span>
              <span className="shrink-0 text-xs font-bold tabular-nums">
                {s.rows.toLocaleString("de-DE")}
              </span>
              <span className="w-11 shrink-0 text-right text-2xs tabular-nums text-muted-foreground">
                {total > 0 ? `${Math.round((s.rows / total) * 100)}%` : "—"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default Pie3D;
