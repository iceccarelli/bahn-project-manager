import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Mangel } from "@shared/abnahme/summary";

/**
 * The prototype's Mängelliste, derived from the answers instead of kept as a
 * second list that had to be renumbered by hand whenever an item flipped.
 */
export function MaengelListe({ maengel, onJump }: { maengel: readonly Mangel[]; onJump: (itemId: string) => void }) {
  if (maengel.length === 0) return null;
  return (
    <Card className="shadow-sm" data-testid="abnahme-maengel">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Mängelliste · {maengel.length.toLocaleString("de-DE")} {maengel.length === 1 ? "Eintrag" : "Einträge"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="divide-y divide-border">
          {maengel.map((m) => (
            <li key={m.itemId} className="flex gap-3 py-2 text-sm">
              <span className="w-6 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{m.nr}</span>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => onJump(m.itemId)}
                  className="text-left font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {m.reference}
                </button>
                <p className={m.beschreibung ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400"}>
                  {m.beschreibung || "Keine Mangelbeschreibung"}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
