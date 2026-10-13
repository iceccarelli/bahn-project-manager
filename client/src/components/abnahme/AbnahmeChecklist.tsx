import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { ChevronsDownUp, ChevronsUpDown, FileText, RotateCcw, Search, SearchX } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AbnahmeAnlage } from "@/components/abnahme/AbnahmeAnlage";
import { itemDomId } from "@/components/abnahme/AbnahmeItemRow";
import { AbnahmeSection } from "@/components/abnahme/AbnahmeSection";
import { AbnahmeSummary } from "@/components/abnahme/AbnahmeSummary";
import { MaengelListe } from "@/components/abnahme/MaengelListe";
import { useAbnahmeSession } from "@/components/abnahme/useAbnahmeSession";
import { PdfPreviewDialog, usePdfPreview } from "@/components/PdfPreviewDialog";
import type { ReportState } from "@/components/abnahme/AbnahmeReport";
import { useAuth } from "@/_core/hooks/useAuth";
import type { Project } from "@/hooks/useDataQuery";
import { formatGerman } from "@shared/date";
import { filterTemplate, isAbnahmeFilter, type AbnahmeFilter } from "@shared/abnahme/filter";
import { deriveMaengel, summarizeTemplate } from "@shared/abnahme/summary";
import type { ChecklistTemplate } from "@shared/abnahme/types";
import { needsChoice, protocolReference } from "@shared/abnahme/pruefbericht";

const FILTER_LABEL: Record<AbnahmeFilter, string> = {
  alle: "Alle",
  offen: "Offen",
  "nicht-bewertet": "Nicht bewertet",
  erfuellt: "Erfüllt",
  entfaellt: "Entfällt",
};

/**
 * One Abnahme: the checklist of one Technik, optionally for one project.
 *
 * The parent mounts this with `key={technik + project}`, so switching either
 * starts a fresh reducer loaded from that key's stored record. The alternative —
 * one instance whose state is swapped by an effect — shows the previous
 * Technik's answers for one frame, and item ids such as 1.1.1 exist in all four
 * checklists, so that frame would show another Technik's ratings as this one's.
 */
export function AbnahmeChecklist({
  template,
  projectId,
  project,
  report,
}: {
  template: ChecklistTemplate;
  projectId: number | null;
  project: Project | null;
  /** The linked Prüfbericht of this Technik, as AbnahmeView resolved it ("off" = not applicable). */
  report: ReportState;
}) {
  const session = useAbnahmeSession(template, projectId);
  const { user } = useAuth();
  const pdf = usePdfPreview();
  const { answers } = session;

  const [searchInput, setSearchInput] = useState("");
  const query = useDeferredValue(searchInput);
  const [filter, setFilter] = useState<AbnahmeFilter>("alle");
  const [openSections, setOpenSections] = useState<ReadonlySet<string>>(
    () => new Set(template.sections.slice(0, 1).map((s) => s.number)),
  );
  const [jumpTo, setJumpTo] = useState<string | null>(null);

  const summary = useMemo(() => summarizeTemplate(template, answers), [template, answers]);
  const maengel = useMemo(() => deriveMaengel(template, answers), [template, answers]);
  const visible = useMemo(() => filterTemplate(template, answers, query, filter), [template, answers, query, filter]);
  const narrowed = query.trim() !== "" || filter !== "alle";
  const allOpen = openSections.size === template.sections.length;
  const visibleCount = useMemo(() => visible.reduce((n, v) => n + v.items.length, 0), [visible]);

  const setSectionOpen = useCallback((number: string, open: boolean) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (open) next.add(number);
      else next.delete(number);
      return next;
    });
  }, []);

  const jump = useCallback(
    (itemId: string) => {
      const section = template.sections.find((s) => s.items.some((i) => i.id === itemId));
      if (!section) return;
      setSearchInput("");
      setFilter("alle");
      setSectionOpen(section.number, true);
      setJumpTo(itemId);
    },
    [template, setSectionOpen],
  );

  // Scroll after the section has actually rendered open; focus the row's first control so a keyboard user lands on it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `openSections` and `visible` are the re-run triggers — the row only exists once its section has rendered open
  useEffect(() => {
    if (!jumpTo) return;
    const row = document.getElementById(itemDomId(jumpTo));
    if (row) {
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      row.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
      setJumpTo(null);
    }
  }, [jumpTo, openSections, visible]);

  // The protocol carries the report's running number and canonical PDF-Code. While the user still has to pick one of
  // several reports (or the list has not arrived) it is not produced: a protocol without the reference it should carry
  // would be filed as if it were complete.
  const reference = protocolReference(report.kind === "ready" ? report.selection : null);
  const pdfBlocked = report.kind === "loading" || report.kind === "error" || (report.kind === "ready" && needsChoice(report.selection));

  const showPdf = () =>
    pdf.show(async () => {
      const { renderAbnahmePdf } = await import("@/pdf/renderAbnahmePdf");
      const itk = project?.reviews?.find((r) => r.department === "ITK");
      return renderAbnahmePdf({
        template,
        answers,
        header: session.header,
        projektnummer: project?.projektnummer ?? "",
        station: project?.station ?? "",
        projektleiter: project?.projektleiter ?? "",
        pruefer: itk?.prueferName ?? "",
        pruefDatum: formatGerman(itk?.pruefDatum) || "",
        pruefbericht: reference,
        // Taken when the button is pressed, not when the page loaded: the stamp says when this sheet was made.
        generatedAt: new Date().toISOString(),
        generatedBy: user?.name || user?.email || "",
      });
    });

  const resetNarrowing = () => {
    setSearchInput("");
    setFilter("alle");
  };

  return (
    <div className="space-y-6">
      {session.persistence === "unavailable" && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Bewertungen werden nicht zwischengespeichert</AlertTitle>
          <AlertDescription>
            Der Browser-Speicher ist blockiert oder voll. Die Abnahme bleibt bedienbar, geht aber beim Neuladen der Seite verloren.
          </AlertDescription>
        </Alert>
      )}

      <AbnahmeSummary summary={summary} />

      <AbnahmeAnlage project={project} header={session.header} onChange={session.setHeaderField} />

      <Card className="shadow-sm">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-[16rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              id="abnahme-search"
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label={`${template.technik}-Checkliste durchsuchen`}
              placeholder="Punkt oder Mangel suchen …"
              autoComplete="off"
              className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
            />
          </div>
          <ToggleGroup
            type="single"
            variant="outline"
            size="lg"
            value={filter}
            onValueChange={(next) => setFilter(isAbnahmeFilter(next) ? next : "alle")}
            aria-label="Nach Status filtern"
            className="flex-wrap gap-1 sm:gap-0"
          >
            {/* Phone: separate chips that wrap. From sm: the joined segmented control the rest of the app uses. */}
            {(Object.keys(FILTER_LABEL) as AbnahmeFilter[]).map((f) => (
              <ToggleGroupItem
                key={f}
                value={f}
                className="flex-none rounded-md px-3 text-xs data-[variant=outline]:border-l sm:rounded-none sm:data-[variant=outline]:border-l-0 sm:data-[variant=outline]:first:border-l"
              >
                {FILTER_LABEL[f]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-10 gap-1.5"
              disabled={narrowed}
              onClick={() => setOpenSections(allOpen ? new Set() : new Set(template.sections.map((s) => s.number)))}
            >
              {allOpen ? <ChevronsDownUp className="h-4 w-4" aria-hidden /> : <ChevronsUpDown className="h-4 w-4" aria-hidden />}
              {allOpen ? "Alle schließen" : "Alle öffnen"}
            </Button>
            <Button
              size="sm"
              className="h-10 gap-1.5 bg-primary text-white hover:bg-primary/90"
              onClick={showPdf}
              disabled={pdfBlocked}
              title={pdfBlocked ? "Erst den Prüfbericht wählen" : undefined}
              data-testid="abnahme-pdf"
            >
              <FileText className="h-4 w-4" aria-hidden /> PDF
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-10 gap-1.5" disabled={summary.total === summary.nichtBewertet}>
                  <RotateCcw className="h-4 w-4" aria-hidden /> Zurücksetzen
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Alle Bewertungen zurücksetzen?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Alle {template.technik}-Bewertungen und Mängel dieser Abnahme werden gelöscht. Anlagendaten bleiben erhalten. Das lässt sich nicht rückgängig machen.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction onClick={session.reset}>Zurücksetzen</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      <output className="block text-xs text-muted-foreground" aria-live="polite">
        {narrowed
          ? `${visibleCount.toLocaleString("de-DE")} von ${summary.total.toLocaleString("de-DE")} Punkten`
          : `${summary.total.toLocaleString("de-DE")} Punkte in ${template.sections.length} Abschnitten`}
        {" · "}Bewertungen bleiben nur in dieser Browser-Sitzung erhalten.
      </output>

      {visible.length === 0 ? (
        <Card className="shadow-sm">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchX aria-hidden />
              </EmptyMedia>
              <EmptyTitle>Keine Punkte gefunden</EmptyTitle>
              <EmptyDescription>Zu dieser Suche und diesem Statusfilter gibt es in der {template.technik}-Checkliste keinen Punkt.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" size="sm" onClick={resetNarrowing}>
                Suche und Filter zurücksetzen
              </Button>
            </EmptyContent>
          </Empty>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map(({ section, items }) => (
            <AbnahmeSection
              key={section.number}
              section={section}
              visibleItems={items}
              answers={answers}
              // A search or filter must show what it found: matching sections open themselves.
              open={narrowed || openSections.has(section.number)}
              onOpenChange={(open) => setSectionOpen(section.number, open)}
              onStatus={session.setStatus}
              onMangel={session.setMangel}
            />
          ))}
        </div>
      )}

      <MaengelListe maengel={maengel} onJump={jump} />

      <PdfPreviewDialog
        title={`Abnahmeprotokoll ${template.technik}`}
        description={project?.projektnummer ? `${project.projektnummer} · ${project.station ?? ""}` : "Freie Abnahme ohne Projektbezug"}
        state={pdf}
      />
    </div>
  );
}
