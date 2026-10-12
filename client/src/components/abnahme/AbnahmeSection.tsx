import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { AbnahmeItemRow } from "@/components/abnahme/AbnahmeItemRow";
import { abnahmeBadgeClass } from "@shared/abnahme/appearance";
import { stateOf, summarizeSection } from "@shared/abnahme/summary";
import type { AbnahmeAnswer, AbnahmeAnswers, ChecklistItem, ChecklistSection } from "@shared/abnahme/types";

/**
 * A numbered section ("1.2 Prüfkriterien Stahlbaukonstruktion und Masten").
 * The counts always describe the whole section, not just the rows a search is
 * currently showing — the header must not change its mind when the filter does.
 */
export function AbnahmeSection({
  section,
  visibleItems,
  answers,
  open,
  onOpenChange,
  onStatus,
  onMangel,
}: {
  section: ChecklistSection;
  visibleItems: readonly ChecklistItem[];
  answers: AbnahmeAnswers;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStatus: (itemId: string, next: AbnahmeAnswer) => void;
  onMangel: (itemId: string, text: string) => void;
}) {
  const sum = summarizeSection(section, answers);
  const bewertet = sum.total - sum.nichtBewertet;
  const filtered = visibleItems.length !== section.items.length;

  return (
    <Card className="overflow-hidden shadow-sm" data-testid={`abnahme-section-${section.number}`}>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&[data-state=open]>svg]:rotate-90">
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform" aria-hidden />
          <span className="font-mono text-xs text-muted-foreground tabular-nums">{section.number}</span>
          {/* basis keeps the title readable on a phone; the counts drop to their own line instead of squeezing it */}
          <span className="min-w-[10rem] flex-1 basis-[10rem] text-sm font-semibold">{section.title}</span>
          <span className="flex shrink-0 items-center gap-2 pl-7 sm:pl-0">
            {sum.offen > 0 && <Badge className={`text-2xs font-bold ${abnahmeBadgeClass("Offen")}`}>{sum.offen} offen</Badge>}
            <Badge variant="secondary" className="text-2xs font-bold tabular-nums">
              {filtered ? `${visibleItems.length} von ${section.items.length} · ` : ""}
              {bewertet}/{sum.total} bewertet
            </Badge>
          </span>
        </CollapsibleTrigger>
        <Progress value={sum.fortschritt} aria-label={`Fortschritt ${section.number}`} className="h-1 rounded-none" />
        <CollapsibleContent>
          <ul className="divide-y divide-border">
            {visibleItems.map((item) => (
              <AbnahmeItemRow key={item.id} item={item} state={stateOf(answers, item.id)} onStatus={onStatus} onMangel={onMangel} />
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
