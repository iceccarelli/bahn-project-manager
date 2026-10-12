import { AlertTriangle, Loader2, PackageOpen } from "lucide-react";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiCard } from "@/components/workspace/KpiCard";
import { usePruefberichtView, usePruefberichteAccess } from "@/hooks/usePruefberichte";
import { ABGESCHLOSSEN_TONE, isAbgeschlossen } from "@shared/itk/vocab";
import { percent } from "@shared/project-metrics";
import { TONE_APPEARANCE, type StatusTone } from "@shared/status-appearance";

const OHNE = "ohne Technik";
/** What the chart colours: closed, still in progress, not closed, and "the workbook cell says something else / nothing". */
const GROUPS = ["done", "pending", "blocked", "none"] as const;
type Group = (typeof GROUPS)[number];
const GROUP_LABEL: Record<Group, string> = { done: "abgeschlossen (Ja, Ja (m.A.))", pending: "in Bearbeitung", blocked: "Nein", none: "ohne Angabe / anderer Wert" };
const GROUP_HEX: Record<Group, string> = { done: TONE_APPEARANCE.done.hex, pending: TONE_APPEARANCE.pending.hex, blocked: TONE_APPEARANCE.blocked.hex, none: "#94a3b8" };

function groupOf(value: string): Group {
  if (!isAbgeschlossen(value)) return "none";
  const tone: StatusTone = ABGESCHLOSSEN_TONE[value];
  return tone === "done" ? "done" : tone === "pending" ? "pending" : tone === "blocked" ? "blocked" : "none";
}

/**
 * The "Technik-Übersicht" tab of /psv-itk: the Prüfstelle's Prüfberichte by Technik — the platform's
 * Technik-Verteilung, with the year spread and how many are closed. Counts are Prüfberichte (rows of the workbook).
 */
export default function TechnikView() {
  const access = usePruefberichteAccess();
  const { data, isLoading, isError } = usePruefberichtView(access.view);

  const rows = useMemo(
    () =>
      (data?.technik ?? []).map((t) => {
        const groups: Record<Group, number> = { done: 0, pending: 0, blocked: 0, none: 0 };
        for (const [v, n] of Object.entries(t.abgeschlossen)) groups[groupOf(v)] += n;
        return { ...t, name: t.technik ?? OHNE, groups };
      }),
    [data],
  );

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-background">
        <output className="flex flex-col items-center gap-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary-strong" aria-hidden="true" />
          <span className="text-lg font-medium text-muted-foreground">Lade Technik-Übersicht…</span>
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
            <h2 className="text-lg font-bold">Technik-Übersicht konnte nicht geladen werden</h2>
            <p className="text-sm text-muted-foreground">Bitte die Seite neu laden.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const closed = rows.reduce((n, r) => n + r.groups.done, 0);
  const technikCount = rows.filter((r) => r.technik !== null).length;
  const withoutTechnik = rows.find((r) => r.technik === null)?.count ?? 0;

  return (
    <div className="min-h-screen space-y-8 bg-background p-6">
      <div>
        <h1 className="page-title">ITK-Technik-Übersicht</h1>
        <p className="mt-2 text-muted-foreground">
          {data.total.toLocaleString("de-DE")} Prüfberichte der Prüfstelle nach Technik
          {data.years.length > 0 ? ` • ${data.years[0]}–${data.years[data.years.length - 1]}` : ""}
        </p>
      </div>

      {data.total === 0 ? (
        <Card className="shadow-sm">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PackageOpen aria-hidden />
              </EmptyMedia>
              <EmptyTitle>Noch keine Prüfberichte importiert</EmptyTitle>
              <EmptyDescription>
                {access.import ? (
                  <>
                    Die Arbeitsmappe der Prüfstelle wird im Reiter <Link href="/psv-itk?tab=pdf-codes" className="underline">PDF-Codes</Link> importiert.
                  </>
                ) : (
                  "Ein Administrator importiert die Arbeitsmappe der Prüfstelle."
                )}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4" data-testid="technik-kpis">
            <KpiCard accent label="Prüfberichte" value={data.total} caption={`in ${data.years.length} Jahren`} valueTone="text-primary-strong" />
            <KpiCard label="Techniken" value={technikCount} caption="verschiedene Technik-Angaben" />
            <KpiCard
              label="Abgeschlossen"
              value={closed}
              caption={`${percent(closed, data.total)}% (Ja, Ja (m.A.))`}
              valueTone="text-emerald-700 dark:text-emerald-400"
              captionTone="text-emerald-700 dark:text-emerald-400"
            />
            <KpiCard
              label="Ohne Technik"
              value={withoutTechnik}
              caption={withoutTechnik ? "Zelle in der Arbeitsmappe leer" : "alle Prüfberichte haben eine Technik"}
              valueTone={withoutTechnik ? "text-amber-700 dark:text-amber-400" : undefined}
              captionTone={withoutTechnik ? "text-amber-700 dark:text-amber-400" : undefined}
            />
          </div>

          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Prüfberichte je Technik nach Stand</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="w-full" style={{ height: Math.max(220, rows.length * 38 + 40) }} aria-hidden="true" data-testid="technik-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rows.map((r) => ({ name: r.name, ...r.groups }))} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tickLine={false} fontSize={12} />
                    <YAxis type="category" dataKey="name" width={96} tickLine={false} axisLine={false} fontSize={12} />
                    <Tooltip cursor={{ fill: "rgba(148,163,184,0.15)" }} />
                    {GROUPS.map((g) => (
                      <Bar key={g} dataKey={g} name={GROUP_LABEL[g]} stackId="stand" fill={GROUP_HEX[g]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {GROUPS.map((g) => (
                  <li key={g} className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: GROUP_HEX[g] }} aria-hidden="true" />
                    {GROUP_LABEL[g]}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Technik und Jahr</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table data-testid="technik-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Technik</TableHead>
                    <TableHead className="text-right">Prüfberichte</TableHead>
                    <TableHead className="text-right">Anteil</TableHead>
                    {data.years.map((y) => (
                      <TableHead key={y} className="text-right">
                        {y}
                      </TableHead>
                    ))}
                    <TableHead className="text-right">Abgeschlossen</TableHead>
                    <TableHead>
                      <span className="sr-only">Prüfberichte anzeigen</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.name}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.count.toLocaleString("de-DE")}</TableCell>
                      <TableCell className="text-right tabular-nums">{percent(r.count, data.total)}%</TableCell>
                      {data.years.map((y) => (
                        <TableCell key={y} className="text-right tabular-nums text-muted-foreground">
                          {(r.perYear[String(y)] ?? 0).toLocaleString("de-DE")}
                        </TableCell>
                      ))}
                      <TableCell className="text-right tabular-nums">
                        {r.groups.done.toLocaleString("de-DE")} · {percent(r.groups.done, r.count)}%
                      </TableCell>
                      <TableCell>
                        {r.technik !== null && (
                          <Link
                            href={`/psv-itk?tab=pdf-codes&technik=${encodeURIComponent(r.technik)}`}
                            className="text-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            anzeigen
                          </Link>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <p className="text-xs leading-relaxed text-muted-foreground">
            Technik und „abgeschlossen“ stehen so da, wie die Arbeitsmappe sie enthält; Werte außerhalb der bekannten Listen (ELA, Video, WLAN, ZIM, DSA+, SAA, dBOS,
            FQM, 3SZ, BÜ bzw. Ja, Ja (m.A.), Nein, in Bearbeitung) werden nicht umgeschrieben. Der Importbericht nennt sie.
          </p>
        </>
      )}
    </div>
  );
}
