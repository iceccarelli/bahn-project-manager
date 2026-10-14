import { ClipboardX } from "lucide-react";
import { useMemo } from "react";
import { AbnahmeChecklist } from "@/components/abnahme/AbnahmeChecklist";
import { AbnahmeReport, type ReportState } from "@/components/abnahme/AbnahmeReport";
import { AbnahmeProjectPicker } from "@/components/abnahme/AbnahmeProjectPicker";
import { TechnikSelect } from "@/components/abnahme/TechnikSelect";
import { useAbnahmeRoute } from "@/components/abnahme/useAbnahmeRoute";
import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useProjectsPageExtras } from "@/hooks/useProjectsPage";
import { useLinkAccess, useProjectPruefberichte } from "@/hooks/useProjectLinks";
import { eligibleReports, selectReport } from "@shared/abnahme/pruefbericht";
import { templateFor } from "@shared/abnahme/templates";

/**
 * The "Abnahme" tab of /psv-itk: the fachtechnische Abnahme checklists of an
 * ITK installation, worked through on screen.
 *
 * Same page frame as the Übersicht (p-6, page-title, KPI row, toolbar card), so
 * switching tabs changes the content and nothing else. The Übersicht lists
 * projects; this is where one is accepted.
 */
export default function AbnahmeView() {
  const { technik, projectId, pruefberichtId, setTechnik, setProjectId, setPruefberichtId } = useAbnahmeRoute();
  const template = templateFor(technik);
  // Resolved through the page-extras hook, which reads the in-browser set or the server detail query by data plane.
  const { detailProject } = useProjectsPageExtras([], projectId);

  // The project's linked Prüfberichte of THIS Technik (server mode, and only for principals who may see reports).
  const access = useLinkAccess();
  const reports = useProjectPruefberichte(projectId);
  const report: ReportState = useMemo(() => {
    if (projectId === null || !access.view) return { kind: "off" };
    if (reports.isLoading) return { kind: "loading" };
    if (reports.isError || !reports.data) return { kind: "error" };
    const eligible = eligibleReports(technik, reports.data);
    return { kind: "ready", selection: selectReport(eligible, pruefberichtId), linkedElsewhere: reports.data.length - eligible.length };
  }, [projectId, access.view, reports.isLoading, reports.isError, reports.data, technik, pruefberichtId]);

  return (
    <div className="min-h-screen space-y-8 bg-background p-6">
      <div>
        <h1 className="page-title">ITK-Abnahme</h1>
        <p className="mt-2 text-muted-foreground">Fachtechnische Abnahme je Technik, optional einem ITK-Projekt zugeordnet</p>
      </div>

      <Card className="shadow-sm">
        <div className="flex flex-wrap items-end gap-4 p-4">
          <TechnikSelect value={technik} onChange={setTechnik} />
          <AbnahmeProjectPicker projectId={projectId} project={detailProject} onChange={setProjectId} />
          <AbnahmeReport state={report} chosenId={pruefberichtId} onChoose={setPruefberichtId} technik={technik} />
        </div>
      </Card>

      {template ? (
        <AbnahmeChecklist key={`${technik}:${projectId ?? "frei"}`} template={template} projectId={projectId} project={detailProject} report={report} />
      ) : (
        <Card className="shadow-sm">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ClipboardX aria-hidden />
              </EmptyMedia>
              <EmptyTitle>Für {technik} liegt noch keine Checkliste vor</EmptyTitle>
              <EmptyDescription>Verfügbar sind ZIM, Video, DSA+ und dBOS.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </Card>
      )}
    </div>
  );
}
