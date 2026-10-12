import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Project } from "@/hooks/useDataQuery";
import { formatGerman } from "@shared/date";
import type { AbnahmeHeader } from "@shared/abnahme/types";

/**
 * The report header of the prototype (Gewerk/Anlage, Prüfdatum, Errichter,
 * Projektleiter). What the project already knows is shown read-only from the
 * Project aggregate and never copied into Abnahme state; only the two facts the
 * project model has no field for — Anlage and Errichter — are typed here.
 */
export function AbnahmeAnlage({
  project,
  header,
  onChange,
}: {
  project: Project | null;
  header: AbnahmeHeader;
  onChange: (field: keyof AbnahmeHeader, value: string) => void;
}) {
  const itk = project?.reviews?.find((r) => r.department === "ITK");
  const facts: Array<[string, string]> = project
    ? [
        ["Projektnummer", project.projektnummer ?? "—"],
        ["Station", project.station ?? "—"],
        ["Projektleitung", project.projektleiter ?? "—"],
        ["ITK-Prüfer", itk?.prueferName ?? "—"],
        ["Prüfdatum", formatGerman(itk?.pruefDatum) || "—"],
      ]
    : [];

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Anlagendaten</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {facts.length > 0 && (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
            {facts.map(([term, value]) => (
              <div key={term} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{term}</dt>
                <dd className="truncate font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="abnahme-anlage" className="text-xs font-medium text-muted-foreground">
              Gewerk / Anlage
            </Label>
            <Input id="abnahme-anlage" value={header.gewerkAnlage} maxLength={200} onChange={(e) => onChange("gewerkAnlage", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="abnahme-errichter" className="text-xs font-medium text-muted-foreground">
              Errichter (Firma)
            </Label>
            <Input id="abnahme-errichter" value={header.errichter} maxLength={200} onChange={(e) => onChange("errichter", e.target.value)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
