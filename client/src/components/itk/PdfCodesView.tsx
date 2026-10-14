import { AlertTriangle, Copy, FileSpreadsheet, Loader2, PackageOpen, Search } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PruefberichtImportDialog } from "@/components/itk/PruefberichtImportDialog";
import { useUrlParams } from "@/components/itk/useUrlParams";
import { usePruefberichtList, usePruefberichtView, usePruefberichteAccess } from "@/hooks/usePruefberichte";
import { derivePdfCode, samePdfCode } from "@shared/itk/pdf-code";
import { ABGESCHLOSSEN_TONE, isAbgeschlossen } from "@shared/itk/vocab";
import { formatGerman } from "@shared/date";
import { TONE_APPEARANCE } from "@shared/status-appearance";

const ALL = "__all__";
const PARAMS = ["year", "technik", "abgeschlossen"] as const;

const badgeFor = (v: string | null) => (v && isAbgeschlossen(v) ? TONE_APPEARANCE[ABGESCHLOSSEN_TONE[v]].badge : TONE_APPEARANCE.neutral.badge);

/**
 * The "PDF-Codes" tab of /psv-itk: every Prüfbericht of the Prüfstelle with the PDF-Code the workbook formula gives it
 * (shared/itk/pdf-code.ts) — derived, never a second stored copy; where the code stored in the workbook differs, the
 * row says so. Admins import the workbook here.
 */
export default function PdfCodesView() {
  const access = usePruefberichteAccess();
  const { values, set } = useUrlParams(PARAMS);
  const [q, setQ] = useState("");
  const deferredQ = useDeferredValue(q.trim());
  const [importing, setImporting] = useState(false);

  const filters = useMemo(
    () => ({
      ...(values.year ? { year: Number(values.year) } : {}),
      ...(values.technik ? { technik: values.technik } : {}),
      ...(values.abgeschlossen ? { abgeschlossen: values.abgeschlossen } : {}),
      ...(deferredQ ? { q: deferredQ } : {}),
    }),
    [values, deferredQ],
  );
  const view = usePruefberichtView(access.view);
  const list = usePruefberichtList(filters, access.view);
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.rows) ?? [], [list.data]);
  const empty = view.data?.total === 0;

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success("PDF-Code kopiert");
    } catch {
      toast.error("Kopieren nicht möglich");
    }
  };

  const selectFilter = (id: string, label: string, name: (typeof PARAMS)[number], options: readonly { value: string; label: string }[]) => (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Select value={values[name] || ALL} onValueChange={(v) => set({ [name]: v === ALL ? "" : v })}>
        <SelectTrigger id={id} className="w-full sm:w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Alle</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="min-h-screen space-y-8 bg-background p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">ITK-PDF-Codes</h1>
          <p className="mt-2 text-muted-foreground">
            Prüfberichte der Prüfstelle mit dem Code, den die Arbeitsmappen-Formel daraus macht
            {view.data ? ` • ${view.data.total.toLocaleString("de-DE")} Prüfberichte` : ""}
          </p>
        </div>
        {access.import && (
          <Button className="h-10 gap-2 bg-primary text-white hover:bg-primary/90" onClick={() => setImporting(true)}>
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            Arbeitsmappe importieren
          </Button>
        )}
      </div>

      {empty ? (
        <Card className="shadow-sm">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PackageOpen aria-hidden />
              </EmptyMedia>
              <EmptyTitle>Noch keine Prüfberichte importiert</EmptyTitle>
              <EmptyDescription>
                {access.import ? "Mit „Arbeitsmappe importieren“ wird die Projektübersicht ITK (.xlsx) eingelesen; vorher zeigt ein Bericht, was verstanden wurde." : "Ein Administrator importiert die Arbeitsmappe der Prüfstelle."}
              </EmptyDescription>
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
                  id="pdfcode-search"
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  aria-label="Prüfberichte durchsuchen"
                  placeholder="Nummer, Bahnhof, PL, FS, PDF-Code …"
                  autoComplete="off"
                  className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
                />
              </div>
              {selectFilter("pdfcode-year", "Jahr", "year", (view.data?.years ?? []).slice().reverse().map((y) => ({ value: String(y), label: String(y) })))}
              {selectFilter("pdfcode-technik", "Technik", "technik", (view.data?.technik ?? []).filter((t) => t.technik !== null).map((t) => ({ value: t.technik as string, label: t.technik as string })))}
              {selectFilter("pdfcode-ab", "abgeschlossen", "abgeschlossen", (view.data?.abgeschlossen ?? []).filter((a) => a.value !== null).map((a) => ({ value: a.value as string, label: a.value as string })))}
            </CardContent>
          </Card>

          {list.isLoading ? (
            <output className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-primary-strong" aria-hidden="true" />
              <span className="font-medium">Lade Prüfberichte…</span>
            </output>
          ) : list.isError ? (
            <Card className="border-2 border-destructive/30">
              <CardContent className="flex items-center gap-3 p-6">
                <AlertTriangle className="h-6 w-6 shrink-0 text-destructive" aria-hidden="true" />
                <p className="text-sm">Prüfberichte konnten nicht geladen werden. Bitte die Seite neu laden.</p>
              </CardContent>
            </Card>
          ) : rows.length === 0 ? (
            <Card className="shadow-sm">
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Search aria-hidden />
                  </EmptyMedia>
                  <EmptyTitle>Keine Prüfberichte gefunden</EmptyTitle>
                  <EmptyDescription>Zu dieser Suche und diesen Filtern gibt es keinen Prüfbericht.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            </Card>
          ) : (
            <Card className="shadow-sm">
              <CardContent className="overflow-x-auto p-0">
                <Table data-testid="pdfcode-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Jahr</TableHead>
                      <TableHead>Nr.</TableHead>
                      <TableHead>Datum</TableHead>
                      <TableHead>Bahnhof / Strecke</TableHead>
                      <TableHead>Technik</TableHead>
                      <TableHead>Tätigkeitsbereich</TableHead>
                      <TableHead>abgeschlossen</TableHead>
                      <TableHead>PL</TableHead>
                      <TableHead>FS</TableHead>
                      <TableHead>Projekt</TableHead>
                      <TableHead>PDF-Code</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const code = derivePdfCode(r);
                      const differs = r.beschriftung !== null && !samePdfCode(r.beschriftung, code);
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="tabular-nums">{r.year}</TableCell>
                          <TableCell className="font-mono text-xs">{r.laufendeNummer}</TableCell>
                          <TableCell className="whitespace-nowrap tabular-nums">{formatGerman(r.datum) || "—"}</TableCell>
                          <TableCell className="max-w-[18rem] truncate" title={r.bahnhofStrecke ?? undefined}>{r.bahnhofStrecke ?? "—"}</TableCell>
                          <TableCell title={r.technik ?? undefined}>{r.technikArt ?? "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{r.taetigkeitsbereich ?? "—"}</TableCell>
                          <TableCell>{r.abgeschlossen ? <Badge className={`text-2xs font-bold ${badgeFor(r.abgeschlossen)}`}>{r.abgeschlossen}</Badge> : "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{r.zustaendigerPl ?? "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{r.zustaendigerFs ?? "—"}</TableCell>
                          <TableCell className="max-w-[14rem] truncate">
                            {r.projectId !== null ? (
                              <Link href={`/projects?detail=${r.projectId}`} className="text-primary hover:underline" data-testid="pdfcode-project-link">
                                {[r.project?.projektnummer, r.project?.station].filter(Boolean).join(" · ") || `Projekt ${r.projectId}`}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {code ? (
                              <span className="flex items-center gap-1.5">
                                <code className="whitespace-nowrap font-mono text-xs">{code}</code>
                                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`PDF-Code ${code} kopieren`} onClick={() => void copy(code)}>
                                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                                </Button>
                                {differs && (
                                  <Badge className={`text-2xs font-bold ${TONE_APPEARANCE.attention.badge}`} title={`In der Arbeitsmappe steht: ${r.beschriftung}`}>
                                    weicht ab
                                  </Badge>
                                )}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
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
                {list.isFetchingNextPage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                Weitere laden
              </Button>
            </div>
          )}
          <output className="block text-xs text-muted-foreground" aria-live="polite">
            {rows.length.toLocaleString("de-DE")} Prüfberichte geladen{list.hasNextPage ? " — weitere vorhanden" : ""}.
          </output>
        </>
      )}

      {access.import && <PruefberichtImportDialog open={importing} onOpenChange={setImporting} />}
    </div>
  );
}
