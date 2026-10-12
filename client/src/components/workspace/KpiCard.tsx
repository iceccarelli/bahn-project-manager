import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The Projekte KPI card, verbatim.
 *
 * Same wrapper, same header, same 4xl figure, same 12px caption, same accent
 * on the first card. Copying the markup rather than approximating it is the
 * point: a reader moving between the three tabs must not be able to tell which
 * one they are on from the chrome, only from the numbers.
 *
 * One component now: ReviewWorkspace (Projekte, BVB-EEA, PSV-ITK Übersicht) and
 * the PSV-ITK Abnahme tab render the same card, so the tab bar on /psv-itk
 * switches content, not chrome.
 */
export function KpiCard({
  label,
  value,
  caption,
  accent,
  valueTone,
  captionTone,
}: {
  label: string;
  /** null while a server read model has not arrived: shown as an en dash, never as 0. */
  value: number | null;
  caption: string;
  accent?: boolean;
  valueTone?: string;
  captionTone?: string;
}) {
  return (
    <Card className={accent ? "border-l-4 border-l-primary shadow-sm" : "shadow-sm"}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-4xl font-bold ${valueTone ?? ""}`}>
          {value === null ? "–" : value.toLocaleString("de-DE")}
        </div>
        <p className={`mt-1 text-xs ${captionTone ?? "text-muted-foreground"}`}>{caption}</p>
      </CardContent>
    </Card>
  );
}
