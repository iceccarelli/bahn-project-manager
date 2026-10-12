import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { hasTemplate } from "@shared/abnahme/templates";
import { ABNAHME_TECHNIKEN, isTechnik, type Technik } from "@shared/abnahme/types";

/**
 * Techniken come from the ITK platform's vocabulary, so ELA, WLAN and SAA are
 * listed even though they have no checklist yet — disabled and labelled, rather
 * than missing, so the reader sees the list is incomplete and not that the
 * Technik does not exist.
 */
export function TechnikSelect({ value, onChange }: { value: Technik; onChange: (next: Technik) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="abnahme-technik" className="text-xs font-medium text-muted-foreground">
        Technik
      </Label>
      <Select value={value} onValueChange={(next) => isTechnik(next) && onChange(next)}>
        <SelectTrigger id="abnahme-technik" className="w-full sm:w-52">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ABNAHME_TECHNIKEN.map((technik) => (
            <SelectItem key={technik} value={technik} disabled={!hasTemplate(technik)}>
              {technik}
              {hasTemplate(technik) ? "" : " – keine Vorlage"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
