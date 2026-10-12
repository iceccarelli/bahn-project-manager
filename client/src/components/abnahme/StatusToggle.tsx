import { Check, CircleDashed, Minus } from "lucide-react";
import type { ComponentType } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ABNAHME_TOGGLE_ON_CLASS } from "@shared/abnahme/appearance";
import { ABNAHME_STATUS, isAbnahmeStatus, type AbnahmeAnswer, type AbnahmeStatus } from "@shared/abnahme/types";

const ICON: Record<AbnahmeStatus, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  Erfüllt: Check,
  Offen: CircleDashed,
  Entfällt: Minus,
};

/**
 * Erfüllt / Offen / Entfällt for one checklist point.
 *
 * A toggle group, not three tab stops: the whole group is one stop and the
 * arrow keys move between the options (Radix roving focus), so a 93-point
 * checklist is not 279 Tab presses. Pressing the active option again clears the
 * answer — the prototype's behaviour, and the only way back to "nicht bewertet".
 */
export function StatusToggle({
  value,
  onChange,
  labelledBy,
}: {
  value: AbnahmeAnswer;
  onChange: (next: AbnahmeAnswer) => void;
  labelledBy: string;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={value ?? ""}
      onValueChange={(next) => onChange(isAbnahmeStatus(next) ? next : null)}
      aria-labelledby={labelledBy}
      className="w-full sm:w-auto"
    >
      {ABNAHME_STATUS.map((status) => {
        const Icon = ICON[status];
        return (
          <ToggleGroupItem
            key={status}
            value={status}
            aria-label={status}
            className={`gap-1.5 px-3 text-xs font-medium sm:flex-none ${ABNAHME_TOGGLE_ON_CLASS[status]}`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {status}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
