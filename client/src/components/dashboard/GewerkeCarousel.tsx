/**
 * The fourteen Gewerke, one at a time, without anybody having to ask.
 *
 * ---------------------------------------------------------------------------
 * What this replaces, and why
 * ---------------------------------------------------------------------------
 * A 320px-tall panel that said "Wählen Sie ein Gewerke" over a chart emoji
 * until the reader found the dropdown. It was the largest empty space on the
 * Dashboard and it hid fourteen status breakdowns behind a control that looked
 * like a filter for something that was not on screen.
 *
 * The panel now always shows one Gewerk and advances every four seconds, so a
 * portfolio nobody asked about goes past anyway. Choosing one from the dropdown
 * pins it: an explicit decision outranks the rotation, always.
 *
 * ---------------------------------------------------------------------------
 * Motion that a person can stop
 * ---------------------------------------------------------------------------
 * WCAG 2.2.2 covers anything that moves, blinks or auto-updates for longer than
 * five seconds, and this does all three. So: a real pause control, pause on
 * hover, pause on keyboard focus anywhere inside, and prefers-reduced-motion
 * turns both the advance and the Ken Burns drift off before the first frame.
 *
 * The drift is deliberately small — 1.0 to 1.04 over eight seconds, no blur,
 * no rotation. A Ken Burns move large enough to notice consciously would move
 * the numbers while somebody is reading them, and this panel exists to be read.
 */
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useLocation } from "wouter";
import { statusHex, statusPulseClass } from "@shared/status-appearance";
import { gewerkHref } from "@shared/search-index";

export interface GewerkeStatusDatum {
  name: string;
  value: number;
  breakdown: Record<string, number>;
}

/** How long one Gewerk holds the panel. */
export const ROTATE_MS = 4000;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return reduced;
}

export function GewerkeCarousel({
  data,
  pinned,
  onPin,
}: {
  data: readonly GewerkeStatusDatum[];
  pinned: string | null;
  onPin: (gewerk: string | null) => void;
}) {
  const [, setLocation] = useLocation();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const reduced = usePrefersReducedMotion();
  const regionId = useId();

  const pinnedIndex = useMemo(
    () => (pinned ? data.findIndex((d) => d.name === pinned) : -1),
    [data, pinned],
  );
  /* A pin is a position, so unpinning leaves the rotation where the reader was
     rather than snapping back to the first Gewerk. */
  const shown = pinnedIndex >= 0 ? pinnedIndex : index;
  const current = data[shown] ?? data[0];

  const rotating = !pinned && !paused && !hovered && !reduced && data.length > 1;

  const go = useCallback(
    (delta: number) => {
      if (data.length === 0) return;
      const next = (shown + delta + data.length) % data.length;
      setIndex(next);
      // Stepping by hand is a decision about position, not about which Gewerk
      // to keep: it moves the rotation, it does not pin.
      if (pinned) onPin(null);
    },
    [data.length, shown, pinned, onPin],
  );

  useEffect(() => {
    if (!rotating) return;
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % data.length),
      ROTATE_MS,
    );
    return () => window.clearInterval(id);
  }, [rotating, data.length]);

  const slices = useMemo(() => {
    if (!current) return [];
    return Object.entries(current.breakdown)
      .sort((a, b) => b[1] - a[1])
      .map(([status, value]) => ({ name: status, value, color: statusHex(status) }));
  }, [current]);

  if (!current) return null;

  return (
    <Card className="border-2 border-primary/20">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="min-w-0 break-words">
              Status-Verteilung für {current.name}
            </CardTitle>
            <p className="mt-0.5 text-2xs text-muted-foreground">
              {pinned
                ? "Angeheftet — die Rotation ist angehalten."
                : reduced
                  ? "Rotation aus (reduzierte Bewegung). Mit den Pfeilen weiterblättern."
                  : `Gewerk ${shown + 1} von ${data.length} · wechselt alle ${ROTATE_MS / 1000} Sekunden`}
            </p>
          </div>
          <div className="w-full sm:w-64 sm:shrink-0">
            <Select
              value={pinned || "all"}
              onValueChange={(value) => onPin(value === "all" ? null : value)}
            >
              <SelectTrigger aria-label="Gewerk anheften">
                <SelectValue placeholder="Gewerke auswählen..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Gewerke — automatisch</SelectItem>
                {data.map((d) => (
                  <SelectItem key={d.name} value={d.name}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <section
          // Hover and focus pause it, so nothing moves under a reader who is
          // reaching for it. A named <section> already carries the region role
          // the carousel pattern wants, so no role attribute is needed — and
          // nothing here is aria-live: a panel that announced every rotation
          // would talk over a screen reader every four seconds.
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onFocusCapture={() => setHovered(true)}
          onBlurCapture={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHovered(false);
          }}
          aria-roledescription="Karussell"
          aria-label="Status-Verteilung je Gewerk"
          data-gewerke-carousel={current.name}
          data-rotating={rotating ? "true" : "false"}
        >
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={() => go(-1)}
              aria-label="Vorherige Status-Verteilung"
              className="h-8 w-8 p-0"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => go(1)}
              aria-label="Nächste Status-Verteilung"
              className="h-8 w-8 p-0"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPaused((v) => !v)}
              aria-pressed={paused}
              disabled={Boolean(pinned) || reduced}
              className="h-8 gap-1.5 text-2xs"
            >
              {paused ? (
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Pause className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {paused ? "Weiter" : "Pause"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setLocation(gewerkHref(current.name))}
              className="ml-auto h-8 text-2xs"
            >
              {current.name} öffnen
            </Button>
          </div>

          {/* The bar of positions doubles as the progress of the rotation. */}
          <ol className="mb-4 flex flex-wrap gap-1" aria-label="Gewerke">
            {data.map((d, i) => (
              <li key={d.name}>
                <button
                  type="button"
                  onClick={() => {
                    setIndex(i);
                    if (pinned) onPin(null);
                  }}
                  aria-current={i === shown ? "true" : undefined}
                  aria-label={`Status-Verteilung für ${d.name} zeigen`}
                  title={d.name}
                  className={`h-1.5 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    i === shown ? "w-7 bg-primary" : "w-3 bg-muted hover:bg-muted-foreground/40"
                  }`}
                />
              </li>
            ))}
          </ol>

          <div
            id={regionId}
            /*
             * The Ken Burns drift, and the crossfade between Gewerke.
             *
             * Keyed on the name so React remounts the subtree on every change,
             * which restarts both animations from zero — without the key the
             * fade plays once on mount and never again.
             */
            key={current.name}
            className="kenburns grid grid-cols-1 gap-6 lg:grid-cols-5"
          >
            <div className="h-[380px] min-w-0 lg:col-span-3">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={slices}
                    cx="50%"
                    cy="50%"
                    innerRadius={80}
                    outerRadius={140}
                    paddingAngle={3}
                    dataKey="value"
                    isAnimationActive={!reduced}
                  >
                    {slices.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend formatter={(value) => <span className="text-foreground">{value}</span>} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="min-w-0 space-y-4 lg:col-span-2">
              <div>
                <div className="mb-1 text-sm text-muted-foreground">Gesamtzahl Prüfungen</div>
                <div className="text-4xl font-bold tabular-nums">
                  {current.value.toLocaleString("de-DE")}
                </div>
              </div>
              <div className="space-y-2 border-t pt-4">
                {slices.map((item) => (
                  <div
                    key={item.name}
                    className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 p-3"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <div
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: item.color }}
                      />
                      {/* Open states breathe here too — the same one function
                          that decides it on every other status surface. */}
                      <span className={`min-w-0 truncate rounded-full px-1 ${statusPulseClass(item.name)}`}>
                        {item.name}
                      </span>
                    </div>
                    <Badge variant="outline" className="shrink-0 tabular-nums">
                      {item.value.toLocaleString("de-DE")}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}

export default GewerkeCarousel;
