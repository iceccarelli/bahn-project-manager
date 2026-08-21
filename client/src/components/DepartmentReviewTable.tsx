/**
 * The one implementation behind /bvb-eea and /psv-itk.
 *
 * Those two pages were 105 near-identical lines each, and every defect the
 * audit found existed twice:
 *
 *   - `statusBadgeClass(review.status)` on the RAW status. It looks up
 *     STATUS_TONE by exact key, so only the 12 canonical values resolve. ITK
 *     stores 3 rows as "Projektkonfiguration" against 51 as "Projektkonfig." —
 *     identical meaning, and the 3 rendered in the neutral grey the page uses
 *     for irrelevant work while the 51 rendered violet.
 *   - `new Date(d).toLocaleDateString("de-DE")`. Two bugs: it drops the leading
 *     zero (19.1.2021 here, 19.01.2021 in the detail dialog — the same review's
 *     date spelled two ways in one app, differing on 627 of 757 dated EEA rows),
 *     and it parses a date-only string as UTC midnight, so west of Greenwich
 *     every one of those 757 rows renders a day early.
 *   - `(p: any)` and `(r: any)` at a boundary that was already typed, deleting
 *     the guarantee rather than adding one.
 *   - A `sticky top-0` thead inside a container with `overflow-x: auto` and no
 *     height. overflow-y then computes to auto, so the thead is bound to a
 *     scrollport that never scrolls: with 814 rows unpaginated, the column
 *     labels leave the screen and never come back.
 *   - `isLoading || !data` rendered the spinner. useAllData returned null for
 *     loading, empty AND failed alike, so a failed read span "Lade …" forever.
 *   - Counts without a German thousands separator, on pages whose parent set
 *     already numbers 1,298.
 */
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, AlertTriangle } from "lucide-react";
import { useAllData, type Project, type Review } from "@/hooks/useDataQuery";
import { statusBadgeClass } from "@shared/status-appearance";
import { normalizeReviewStatus } from "@shared/review-status";
import { formatGerman } from "@shared/date";
import type { Department } from "@shared/types";

interface DepartmentReviewTableProps {
  department: Department;
  /** Page heading. */
  title: string;
  /** What the list actually contains — not what a reader might hope it does. */
  subtitle: string;
  /** Column header for the department's reviewer. */
  prueferLabel: string;
}

const TH = "whitespace-nowrap border-b px-3 py-3 text-left font-semibold text-muted-foreground";

export function DepartmentReviewTable({
  department,
  title,
  subtitle,
  prueferLabel,
}: DepartmentReviewTableProps) {
  const { data, isLoading, isError } = useAllData();

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary-strong" aria-hidden="true" />
          <p className="text-lg font-medium text-muted-foreground">Lade {title}…</p>
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-background p-6">
        <Card className="max-w-md border-2 border-destructive/30">
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden="true" />
            <h2 className="text-lg font-bold">Projektdaten konnten nicht geladen werden</h2>
            <p className="text-sm text-muted-foreground">
              Die Datenquelle hat keine Projekte geliefert. Bitte die Seite neu laden — bleibt es
              dabei, fehlt <code className="font-mono">/data.json</code> oder der lokale Speicher
              ist leer.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // The status is normalised before it is compared, so an unmappable value is
  // dropped deliberately rather than listed under a heading it contradicts.
  const rows = data.projects
    .map((p: Project) => ({
      project: p,
      review: (p.reviews ?? []).find((r: Review) => r.department === department),
    }))
    .filter(({ review }) => {
      const status = normalizeReviewStatus(review?.status);
      return status !== null && status !== "nicht erforderlich";
    });

  return (
    <div className="min-h-screen space-y-8 bg-background p-6">
      <div>
        <h1 className="page-title">{title}</h1>
        <p className="mt-2 text-muted-foreground">
          {subtitle} &bull; {rows.length.toLocaleString("de-DE")}{" "}
          {rows.length === 1 ? "Eintrag" : "Einträge"} von{" "}
          {data.projects.length.toLocaleString("de-DE")} Projekten
        </p>
      </div>

      <Card className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <CardContent className="p-0">
          {/* An explicit max-height is what makes `sticky` mean anything: the
              thead sticks to this scrollport, and without a height the
              scrollport is as tall as its content and never scrolls. */}
          <div className="max-h-[75vh] overflow-x-auto overflow-y-auto">
            <table className="w-full border-collapse text-xs">
              <caption className="sr-only">
                {title} – {rows.length} Einträge mit Prüfer, Prüfdatum und Status
              </caption>
              <thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                <tr>
                  <th scope="col" className={TH}>Projektnummer</th>
                  <th scope="col" className={TH}>Region</th>
                  <th scope="col" className={TH}>Station</th>
                  <th scope="col" className={TH}>Beschreibung</th>
                  <th scope="col" className={TH}>Projektleiter</th>
                  <th scope="col" className={TH}>{prueferLabel}</th>
                  <th scope="col" className={TH}>Prüfdatum</th>
                  <th scope="col" className={TH}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ project, review }) => {
                  const status = normalizeReviewStatus(review?.status);
                  return (
                    <tr key={project.id} className="border-b transition-colors hover:bg-muted/30">
                      {/*
                        No `whitespace-nowrap` on the three free-text columns.
                        A handful of rows carry comma-separated lists — one
                        Projektnummer is 76 characters, one Station 96, one
                        Projektleiter 79 — and nowrap let those single rows set
                        the column width for all 814. The table measured
                        2,499px against a 1,066px viewport: Projektnummer 581px
                        and Station 611px, while the 95th percentile of both is
                        under 30 characters. They wrap now; everything else
                        still fits on one line.
                      */}
                      <td className="max-w-[13rem] px-3 py-3 font-mono text-xs font-medium break-words">
                        {project.projektnummer || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs">
                        {project.bahnhofsmanagement || "—"}
                      </td>
                      <td className="max-w-[14rem] px-3 py-3 text-xs font-medium break-words">
                        {project.station || "—"}
                      </td>
                      <td className="max-w-[20rem] px-3 py-3 text-xs">
                        <span className="line-clamp-2">{project.projektbeschreibung || "—"}</span>
                      </td>
                      <td className="max-w-[12rem] px-3 py-3 text-xs break-words">
                        {project.projektleiter || "—"}
                      </td>
                      <td className="max-w-[11rem] px-3 py-3 text-xs break-words">
                        {review?.prueferName || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs tabular-nums">
                        {formatGerman(review?.pruefDatum) || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-2xs font-medium ${statusBadgeClass(status)}`}
                        >
                          {status ?? review?.status ?? "—"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-muted-foreground">
                      Kein Projekt hat derzeit eine {department}-Prüfung mit einem Status.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default DepartmentReviewTable;
