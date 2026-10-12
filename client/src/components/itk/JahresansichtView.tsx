import { AlertTriangle, CalendarX, Loader2 } from "lucide-react";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { parseYearSelection, useJahresRoute, type YearSelection } from "@/components/itk/useJahresRoute";
import { KpiCard } from "@/components/workspace/KpiCard";
import { useItkYears } from "@/hooks/useItkYears";
import type { ItkYearsView, RankRow, YearBucket } from "@shared/itk/jahresansicht";
import { percent } from "@shared/project-metrics";
import { TONE_APPEARANCE, type StatusTone } from "@shared/status-appearance";

/** Bar stacking order: signed off at the bottom, blocked on top. */
const TONE_ORDER: readonly (StatusTone | "none")[] = ["done", "review", "active", "attention", "pending", "paused", "blocked", "none"];
const toneLabel = (t: StatusTone | "none") => (t === "none" ? "ohne Status" : TONE_APPEARANCE[t].label);
const toneHex = (t: StatusTone | "none") => (t === "none" ? "#94a3b8" : TONE_APPEARANCE[t].hex);

const yearLabel = (y: number | null) => (y === null ? "ohne Datum" : String(y));
const keyOf = (b: YearBucket): YearSelection => (b.year === null ? "ohne" : b.year);

function pick(view: ItkYearsView, selection: YearSelection): YearBucket | null {
  if (selection === "alle") return view.all;
  return view.years.find((b) => keyOf(b) === selection) ?? null;
}

function Ranking({ title, rows, bucketTotal }: { title: string; rows: readonly RankRow[]; bucketTotal: number }) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Angaben in dieser Auswahl.</p>
        ) : (
          <ol className="space-y-3">
            {rows.map((r) => (
              <li key={r.name} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  {/* The Übersicht's search covers Projektleitung and Prüfer, so the name is a working link into it. */}
                  <Link
                    href={`/psv-itk?q=${encodeURIComponent(r.name)}`}
                    className="min-w-0 truncate font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {r.name}
                  </Link>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {r.count.toLocaleString("de-DE")} · {r.approved.toLocaleString("de-DE")} abgeschlossen
                  </span>
                </div>
                <Progress value={percent(r.count, bucketTotal)} aria-label={`${r.name}: Anteil an den Prüfungen`} className="h-1.5" />
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The "Jahresansicht" tab of /psv-itk: the ITK Prüfungen by year, from the
 * Projektübersicht ITK platform's yearly tabs and dashboard (see
 * shared/itk/jahresansicht.ts for what maps to what, and what it does not claim).
 * Same page frame, KPI card, toolbar card and status colours as the Übersicht.
 */
export default function JahresansichtView() {
  const { data, isLoading, isError } = useItkYears();
  const { selection, select } = useJahresRoute();

  const bucket = useMemo(() => (data ? pick(data, selection) : null), [data, selection]);

  const chartData = useMemo(
    () =>
      (data?.years ?? []).map((b) => ({
        key: keyOf(b),
        label: yearLabel(b.year),
        ...Object.fromEntries(TONE_ORDER.map((t) => [t, b.tones[t] ?? 0])),
      })),
    [data],
  );
  const usedTones = useMemo(() => TONE_ORDER.filter((t) => (data?.all.tones[t] ?? 0) > 0), [data]);

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-background">
        <output className="flex flex-col items-center gap-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary-strong" aria-hidden="true" />
          <span className="text-lg font-medium text-muted-foreground">Lade ITK-Jahresansicht…</span>
        </output>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-background p-6">
        <Card className="max-w-md border-2 border-destructive/30">
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden="true" />
            <h2 className="text-lg font-bold">Jahresansicht konnte nicht geladen werden</h2>
            <p className="text-sm text-muted-foreground">Die Datenquelle hat keine Projekte geliefert. Bitte die Seite neu laden.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const total = data.all.metrics.total;
  const m = bucket?.metrics;

  return (
    <div className="min-h-screen space-y-8 bg-background p-6">
      <div>
        <h1 className="page-title">ITK-Jahresansicht</h1>
        <p className="mt-2 text-muted-foreground">
          {total.toLocaleString("de-DE")} ITK-Prüfungen nach Jahr des Prüfdatums &bull; Projektleitung und Prüfer
        </p>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-4">
          <ToggleGroup
            type="single"
            variant="outline"
            size="lg"
            value={String(selection)}
            onValueChange={(next) => next && select(parseYearSelection(next === "ohne" ? "ohne" : next === "alle" ? null : next))}
            aria-label="Jahr wählen"
            className="flex-wrap gap-1 sm:gap-0"
          >
            {/* Phone: separate chips that wrap. From sm: the joined segmented control, as in the Abnahme filter. */}
            {[{ value: "alle", label: "Alle Jahre" }, ...data.years.map((b) => ({ value: String(keyOf(b)), label: yearLabel(b.year) }))].map((o) => (
              <ToggleGroupItem
                key={o.value}
                value={o.value}
                className="flex-none rounded-md px-4 text-sm data-[variant=outline]:border-l sm:rounded-none sm:data-[variant=outline]:border-l-0 sm:data-[variant=outline]:first:border-l"
              >
                {o.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </CardContent>
      </Card>

      {!bucket || !m ? (
        <Card className="shadow-sm">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarX aria-hidden />
              </EmptyMedia>
              <EmptyTitle>Für dieses Jahr gibt es keine ITK-Prüfungen</EmptyTitle>
              <EmptyDescription>Wählen Sie ein anderes Jahr oder „Alle Jahre“.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4" data-testid="jahres-kpis">
            <KpiCard
              accent
              label={selection === "alle" ? "Projekte mit ITK-Prüfung" : `ITK-Prüfungen ${yearLabel(bucket.year)}`}
              value={m.total}
              caption={selection === "alle" ? "über alle Jahre" : `${percent(m.total, total)}% aller ITK-Prüfungen`}
              valueTone="text-primary-strong"
            />
            <KpiCard
              label="Aktiv"
              value={m.active}
              caption={`${percent(m.active, m.total)}% in Bearbeitung`}
              captionTone="text-blue-700 dark:text-blue-400"
            />
            <KpiCard
              label="Abgeschlossen"
              value={m.completed}
              caption={`${percent(m.completed, m.total)}% zugestimmt`}
              valueTone="text-emerald-700 dark:text-emerald-400"
              captionTone="text-emerald-700 dark:text-emerald-400"
            />
            <KpiCard
              label="Blockiert"
              value={m.blocked}
              caption="abgelehnt oder gestoppt"
              valueTone="text-red-600 dark:text-red-400"
              captionTone="text-red-600 dark:text-red-400"
            />
          </div>

          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Prüfungen je Jahr nach Status</CardTitle>
            </CardHeader>
            <CardContent>
              {/* The chart is a picture of the table below it; the table is the accessible version of the same numbers. */}
              <div className="h-72 w-full" aria-hidden="true" data-testid="jahres-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} fontSize={12} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                    <Tooltip cursor={{ fill: "rgba(148,163,184,0.15)" }} />
                    {usedTones.map((t) => (
                      <Bar key={t} dataKey={t} name={toneLabel(t)} stackId="status" fill={toneHex(t)} onClick={(d: { key?: YearSelection }) => d?.key !== undefined && select(d.key)}>
                        {chartData.map((row) => (
                          <Cell key={row.label} fillOpacity={selection === "alle" || selection === row.key ? 1 : 0.4} cursor="pointer" />
                        ))}
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {usedTones.map((t) => (
                  <li key={t} className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: toneHex(t) }} aria-hidden="true" />
                    {toneLabel(t)}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Ranking title={`Projektleitung · ${selection === "alle" ? "alle Jahre" : yearLabel(bucket.year)}`} rows={bucket.projektleitung} bucketTotal={m.total} />
            <Ranking title={`ITK-Prüfer · ${selection === "alle" ? "alle Jahre" : yearLabel(bucket.year)}`} rows={bucket.pruefer} bucketTotal={m.total} />
          </div>

          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Jahresübersicht</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table data-testid="jahres-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Jahr</TableHead>
                    <TableHead className="text-right">Prüfungen</TableHead>
                    <TableHead className="text-right">Aktiv</TableHead>
                    <TableHead className="text-right">Abgeschlossen</TableHead>
                    <TableHead className="text-right">Blockiert</TableHead>
                    <TableHead className="text-right">Abschlussquote</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...data.years, data.all].map((b) => {
                    const isAll = b === data.all;
                    const sel = isAll ? "alle" : keyOf(b);
                    return (
                      <TableRow key={isAll ? "alle" : String(keyOf(b))} data-state={selection === sel ? "selected" : undefined} className={isAll ? "font-semibold" : undefined}>
                        <TableCell>
                          <button
                            type="button"
                            onClick={() => select(sel)}
                            aria-pressed={selection === sel}
                            className="rounded px-1 text-left underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {isAll ? "Alle Jahre" : yearLabel(b.year)}
                          </button>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{b.metrics.total.toLocaleString("de-DE")}</TableCell>
                        <TableCell className="text-right tabular-nums">{b.metrics.active.toLocaleString("de-DE")}</TableCell>
                        <TableCell className="text-right tabular-nums">{b.metrics.completed.toLocaleString("de-DE")}</TableCell>
                        <TableCell className="text-right tabular-nums">{b.metrics.blocked.toLocaleString("de-DE")}</TableCell>
                        <TableCell className="text-right tabular-nums">{percent(b.metrics.completed, b.metrics.total)}%</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <p className="text-xs leading-relaxed text-muted-foreground">
            Jahr = Jahr des ITK-Prüfdatums; Prüfungen ohne Prüfdatum stehen unter „ohne Datum“. Technik, Tätigkeitsbereich und PDF-Code gehören zum Prüfbericht der
            Projektübersicht-ITK-Plattform und sind in diesem Datenbestand nicht erfasst.
          </p>
        </>
      )}
    </div>
  );
}
