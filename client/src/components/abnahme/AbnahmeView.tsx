import { ClipboardX } from "lucide-react";
import { AbnahmeChecklist } from "@/components/abnahme/AbnahmeChecklist";
import { AbnahmeProjectPicker } from "@/components/abnahme/AbnahmeProjectPicker";
import { TechnikSelect } from "@/components/abnahme/TechnikSelect";
import { useAbnahmeRoute } from "@/components/abnahme/useAbnahmeRoute";
import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useProjectsPageExtras } from "@/hooks/useProjectsPage";
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
  const { technik, projectId, setTechnik, setProjectId } = useAbnahmeRoute();
  const template = templateFor(technik);
  // Resolved through the page-extras hook, which reads the in-browser set or the server detail query by data plane.
  const { detailProject } = useProjectsPageExtras([], projectId);

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
        </div>
      </Card>

      {template ? (
        <AbnahmeChecklist key={`${technik}:${projectId ?? "frei"}`} template={template} projectId={projectId} project={detailProject} />
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
