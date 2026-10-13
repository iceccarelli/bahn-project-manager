import { AlertTriangle, FileSpreadsheet, Link2, Loader2, PackageOpen, Pencil, Search } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { Link } from "wouter";
import { AutoLinkDialog } from "@/components/itk/AutoLinkDialog";
import { LinkProjectDialog } from "@/components/itk/LinkProjectDialog";
import { PruefberichtImportDialog } from "@/components/itk/PruefberichtImportDialog";
import { useUrlParams } from "@/components/itk/useUrlParams";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePruefberichtList, usePruefberichtView, usePruefberichteAccess } from "@/hooks/usePruefberichte";
import { useLinkAccess } from "@/hooks/useProjectLinks";
import { derivePdfCode } from "@shared/itk/pdf-code";
import type { PruefberichtListRow } from "@shared/itk/pruefbericht-contract";
import { ABGESCHLOSSEN_TONE, isAbgeschlossen } from "@shared/itk/vocab";
import { formatGerman } from "@shared/date";
import { TONE_APPEARANCE } from "@shared/status-appearance";

const ALL = "__all__";
const PARAMS = ["year", "verknuepfung", "q"] as const;
const badgeFor = (v: string | null) => (v && isAbgeschlossen(v) ? TONE_APPEARANCE[ABGESCHLOSSEN_TONE[v]].badge : TONE_APPEARANCE.neutral.badge);

/**
 * "Projektübersicht ITK" — the register of the Prüfstelle's Prüfberichte (the second workbook), next to the project
 * Übersicht (the first workbook). Each report shows the canonical project it belongs to, links back to it, and — for those
 * who may — can be attached to or detached from a project. Reports with no reliable match stay visible as "offen".
 */
export default function ProjektuebersichtView() {
  const access = usePruefberichteAccess();
  const links = useLinkAccess();
  const { values, set } = useUrlParams(PARAMS);
  const [q, setQ] = useState(values.q);
  const deferredQ = useDeferredValue(q.trim());
  const [importing, setImporting] = useState(false);
  const [autoLinking, setAutoLinking] = useState(false);
  const [editing, setEditing] = useState<PruefberichtListRow | null>(null);

  const filters = useMemo(
    () => ({
      ...(values.year ? { year: Number(values.year) } : {}),
      ...(values.verknuepfung === "verknuepft" ? { verknuepfung: "verknuepft" as const } : values.verknuepfung === "offen" ? { verknuepfung: "offen" as const } : {}),
      ...(deferredQ ? { q: deferredQ } : {}),
    }),
    [values.year, values.verknuepfung, deferredQ],
  );
  const view = usePruefberichtView(access.view);
  const list = usePruefberichtList(filters, access.view);
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.rows) ?? [], [list.data]);

  const select = (id: string, label: string, name: "year" | "verknuepfung", options: readonly { value: string; label: string }[]) => (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label}</label>
      <Select value={values[name] || ALL} onValueChange={(v) => set({ [name]: v === ALL ? "" : v })}>
        <SelectTrigger id={id} className="w-full sm:w-44"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Alle</SelectItem>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="min-h-screen space-y-8 bg-background p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Projektübersicht ITK</h1>
          <p className="mt-2 text-muted-foreground">
            Prüfberichte der Prüfstelle und das Projekt, zu dem sie gehören
            {view.data ? ` • ${view.data.total.toLocaleString("de-DE")} Prüfberichte` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {links.bulk && (
            <Button variant="outline" className="h-10 gap-2" onClick={() => setAutoLinking(true)} data-testid="autolink-open">
              <Link2 className="h-4 w-4" aria-hidden /> Automatisch zuordnen
            </Button>
          )}
          {access.import && (
            <Button className="h-10 gap-2 bg-primary text-white hover:bg-primary/90" onClick={() => setImporting(true)}>
              <FileSpreadsheet className="h-4 w-4" aria-hidden /> Arbeitsmappe importieren
            </Button>
          )}
        </div>
      </div>

      {view.data?.total === 0 ? (
        <Card className="shadow-sm">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon"><PackageOpen aria-hidden /></EmptyMedia>
              <EmptyTitle>Noch keine Prüfberichte importiert</EmptyTitle>
              <EmptyDescription>{access.import ? "Mit „Arbeitsmappe importieren“ wird die Projektübersicht ITK (.xlsx) eingelesen." : "Ein Administrator importiert die Arbeitsmappe der Prüfstelle."}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </Card>
      ) : (
        <>
          <Card className="shadow-sm">
            <CardContent className="flex flex-wrap items-end gap-4 p-4">
              <div className="relative min-w-[16rem] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <input
                  id="pu-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Prüfberichte durchsuchen"
                  placeholder="Nummer, Bahnhof, Projektnummer, Projekt, PL, FS …" autoComplete="off"
                  className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
                />
              </div>
              {select("pu-year", "Jahr", "year", (view.data?.years ?? []).slice().reverse().map((y) => ({ value: String(y), label: String(y) })))}
              {select("pu-link", "Projekt", "verknuepfung", [{ value: "verknuepft", label: "zugeordnet" }, { value: "offen", label: "nicht zugeordnet" }])}
            </CardContent>
          </Card>

          {list.isLoading ? (
            <output className="flex items-center justify-center gap-3 py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin text-primary-strong" aria-hidden /><span className="font-medium">Lade Prüfberichte…</span></output>
          ) : list.isError ? (
            <Card className="border-2 border-destructive/30"><CardContent className="flex items-center gap-3 p-6"><AlertTriangle className="h-6 w-6 shrink-0 text-destructive" aria-hidden /><p className="text-sm">Prüfberichte konnten nicht geladen werden. Bitte die Seite neu laden.</p></CardContent></Card>
          ) : rows.length === 0 ? (
            <Card className="shadow-sm"><Empty><EmptyHeader><EmptyMedia variant="icon"><Search aria-hidden /></EmptyMedia><EmptyTitle>Keine Prüfberichte gefunden</EmptyTitle><EmptyDescription>Zu dieser Suche und diesen Filtern gibt es keinen Prüfbericht.</EmptyDescription></EmptyHeader></Empty></Card>
          ) : (
            <Card className="shadow-sm">
              <CardContent className="overflow-x-auto p-0">
                <Table data-testid="pu-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Jahr</TableHead><TableHead>Nr.</TableHead><TableHead>Datum</TableHead><TableHead>Bahnhof / Strecke</TableHead>
                      <TableHead>Projektnummer</TableHead><TableHead>Projekt</TableHead><TableHead>Technik</TableHead><TableHead>abgeschlossen</TableHead><TableHead>PDF-Code</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const code = derivePdfCode(r);
                      return (
                        <TableRow key={r.id} data-testid="pu-row">
                          <TableCell className="tabular-nums">{r.year}</TableCell>
                          <TableCell className="font-mono text-xs">{r.laufendeNummer}</TableCell>
                          <TableCell className="whitespace-nowrap tabular-nums">{formatGerman(r.datum) || "—"}</TableCell>
                          <TableCell className="max-w-[16rem] truncate" title={r.bahnhofStrecke ?? undefined}>{r.bahnhofStrecke ?? "—"}</TableCell>
                          <TableCell className="whitespace-nowrap font-mono text-xs">{r.projektnummer ?? "—"}</TableCell>
                          <TableCell>
                            <span className="flex items-center gap-1.5">
                              {r.projectId !== null ? (
                                <Link href={`/projects?detail=${r.projectId}`} className="max-w-[16rem] truncate text-primary hover:underline" data-testid="pu-project-link">
                                  {[r.project?.projektnummer, r.project?.station].filter(Boolean).join(" · ") || `Projekt ${r.projectId}`}
                                </Link>
                              ) : (
                                <Badge variant="outline" className="text-2xs">nicht zugeordnet</Badge>
                              )}
                              {links.link && (
                                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={r.projectId === null ? `Prüfbericht ${r.laufendeNummer} einem Projekt zuordnen` : `Zuordnung von ${r.laufendeNummer} ändern`} onClick={() => setEditing(r)}>
                                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                                </Button>
                              )}
                            </span>
                          </TableCell>
                          <TableCell title={r.technik ?? undefined}>{r.technikArt ?? "—"}</TableCell>
                          <TableCell>{r.abgeschlossen ? <Badge className={`text-2xs font-bold ${badgeFor(r.abgeschlossen)}`}>{r.abgeschlossen}</Badge> : "—"}</TableCell>
                          <TableCell><code className="whitespace-nowrap font-mono text-xs">{code ?? "—"}</code></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
          {list.hasNextPage && (
            <div className="flex justify-center">
              <Button variant="outline" className="h-10" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                {list.isFetchingNextPage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Weitere laden
              </Button>
            </div>
          )}
          <output className="block text-xs text-muted-foreground" aria-live="polite">{rows.length.toLocaleString("de-DE")} Prüfberichte geladen{list.hasNextPage ? " — weitere vorhanden" : ""}.</output>
        </>
      )}

      {access.import && <PruefberichtImportDialog open={importing} onOpenChange={setImporting} />}
      {links.bulk && <AutoLinkDialog open={autoLinking} onOpenChange={setAutoLinking} />}
      <LinkProjectDialog report={editing} open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null); }} />
    </div>
  );
}
