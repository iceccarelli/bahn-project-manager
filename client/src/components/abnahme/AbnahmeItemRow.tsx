import { memo, useId } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusToggle } from "@/components/abnahme/StatusToggle";
import { MAX_MANGEL } from "@shared/abnahme/state";
import type { AbnahmeAnswer, ChecklistItem, ItemState } from "@shared/abnahme/types";

export const itemDomId = (itemId: string) => `abnahme-item-${itemId}`;

/**
 * One checklist point. Memoised: with 93 rows, typing a Mangel must re-render
 * the row being typed in, not the page — `state` keeps its identity for every
 * other item because the reducer only replaces the entry that changed.
 */
export const AbnahmeItemRow = memo(function AbnahmeItemRow({
  item,
  state,
  onStatus,
  onMangel,
}: {
  item: ChecklistItem;
  state: ItemState;
  onStatus: (itemId: string, next: AbnahmeAnswer) => void;
  onMangel: (itemId: string, text: string) => void;
}) {
  const uid = useId();
  const labelId = `${uid}-label`;
  const mangelId = `${uid}-mangel`;
  const hintId = `${uid}-hint`;
  const offen = state.selected === "Offen";
  const undocumented = offen && state.mangel.trim() === "";

  return (
    <li id={itemDomId(item.id)} className="space-y-2 px-4 py-3 scroll-mt-24">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex min-w-0 gap-3">
          <span className="w-12 shrink-0 pt-0.5 font-mono text-xs text-muted-foreground tabular-nums">{item.id}</span>
          <span id={labelId} className="text-sm leading-snug">
            {item.label}
          </span>
        </div>
        <StatusToggle value={state.selected} onChange={(next) => onStatus(item.id, next)} labelledBy={labelId} />
      </div>
      {offen && (
        <div className="space-y-1.5 sm:pl-[3.75rem]">
          <Label htmlFor={mangelId} className="text-xs font-medium text-muted-foreground">
            Mangel zu {item.id}
          </Label>
          <Textarea
            id={mangelId}
            value={state.mangel}
            maxLength={MAX_MANGEL}
            rows={2}
            placeholder="Mangel beschreiben – was fehlt oder weicht ab?"
            aria-describedby={undocumented ? hintId : undefined}
            onChange={(e) => onMangel(item.id, e.target.value)}
            className="min-h-16 text-sm"
          />
          {undocumented && (
            <p id={hintId} className="text-xs text-amber-700 dark:text-amber-400">
              Noch keine Mangelbeschreibung – ohne sie lässt sich der Punkt nicht an den Errichter geben.
            </p>
          )}
        </div>
      )}
    </li>
  );
});
