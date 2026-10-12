import { KpiCard } from "@/components/workspace/KpiCard";
import type { AbnahmeSummary as Summary } from "@shared/abnahme/summary";

/** The four figures of an Abnahme, in the same card as every other KPI row. */
export function AbnahmeSummary({ summary }: { summary: Summary }) {
  const { total, fortschritt, erfuellt, offen, entfaellt, nichtBewertet, offenOhneMangel } = summary;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4" data-testid="abnahme-summary">
      <KpiCard
        accent
        label="Fortschritt in %"
        value={fortschritt}
        caption={`${(total - nichtBewertet).toLocaleString("de-DE")} von ${total.toLocaleString("de-DE")} Punkten bewertet`}
      />
      <KpiCard
        label="Erfüllt"
        value={erfuellt}
        caption={entfaellt > 0 ? `${entfaellt.toLocaleString("de-DE")} entfallen` : "keine entfallen"}
        valueTone="text-emerald-700 dark:text-emerald-400"
        captionTone="text-emerald-700 dark:text-emerald-400"
      />
      <KpiCard
        label="Offen"
        value={offen}
        caption={offenOhneMangel > 0 ? `${offenOhneMangel.toLocaleString("de-DE")} ohne Mangelbeschreibung` : "alle beschrieben"}
        valueTone="text-amber-700 dark:text-amber-400"
        captionTone={offenOhneMangel > 0 ? "text-amber-700 dark:text-amber-400" : undefined}
      />
      <KpiCard label="Nicht bewertet" value={nichtBewertet} caption="noch zu prüfen" />
    </div>
  );
}
