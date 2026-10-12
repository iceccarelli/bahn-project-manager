import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { ChevronsDownUp, ChevronsUpDown, RotateCcw, Search, SearchX } from "lucide-react";
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
import type { Project } from "@/hooks/useDataQuery";
import { filterTemplate, isAbnahmeFilter, type AbnahmeFilter } from "@shared/abnahme/filter";
import { deriveMaengel, summarizeTemplate } from "@shared/abnahme/summary";
import type { ChecklistTemplate } from "@shared/abnahme/types";

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
}: {
  template: ChecklistTemplate;
  projectId: number | null;
  project: Project | null;
}) {
  const session = useAbnahmeSession(template, projectId);
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
              placeholder="Punkt, Nummer oder Mangel suchen …"
              autoComplete="off"
              className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
            />
          </div>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={filter}
            onValueChange={(next) => setFilter(isAbnahmeFilter(next) ? next : "alle")}
            aria-label="Nach Status filtern"
            className="flex-wrap"
          >
            {(Object.keys(FILTER_LABEL) as AbnahmeFilter[]).map((f) => (
              <ToggleGroupItem key={f} value={f} className="px-3 text-xs sm:flex-none">
                {FILTER_LABEL[f]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5"
              disabled={narrowed}
              onClick={() => setOpenSections(new Set(template.sections.map((s) => s.number)))}
            >
              <ChevronsUpDown className="h-4 w-4" aria-hidden /> Alle öffnen
            </Button>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5" disabled={narrowed} onClick={() => setOpenSections(new Set())}>
              <ChevronsDownUp className="h-4 w-4" aria-hidden /> Alle schließen
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5" disabled={summary.total === summary.nichtBewertet}>
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
    </div>
  );
}
