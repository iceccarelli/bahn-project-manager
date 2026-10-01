import { ReviewWorkspace } from "@/components/workspace/ReviewWorkspace";
import { ServerDepartmentView } from "@/components/workspace/ServerDepartmentView";
import { SERVER_MODE } from "@/realtime/serverApi";

/**
 * The subtitle used to read "Verwaltung der EEA-Freigabeerklärungen".
 *
 * Both halves were wrong. *Verwaltung* implies create/edit/delete and this page
 * had no interactive element at all — the Dashboard's own entry point called it
 * correctly, "BVB-EEA-Prüfungen ansehen". And *Freigabeerklärungen* implies
 * approvals, while the list is every EEA review that is not "nicht
 * erforderlich": of 814 rows only 583 are "Zustimmung erteilt". The other 231
 * are abgelehnt (88), Projektkonfig. (55), offen (54), Nachforderung (26),
 * zurückgestellt (5) and one each of gestoppt, in Bearbeitung and prüffähig —
 * explicitly not Freigaben.
 *
 * The page is no longer read-only: ReviewWorkspace gives it the same KPIs,
 * search, filters, card view, map, detail dialog and export the Projekte page
 * has, all scoped to the EEA reviews.
 */
export default function BvbEea() {
  // Server mode: the same Project aggregate, filtered to this Gewerk — one data plane, one permission model.
  if (SERVER_MODE) return <ServerDepartmentView department="EEA" title="BVB-EEA Prüfungen" subtitle="Übersicht der EEA-Prüfungen" prueferLabel="EEA-Prüfer" />;
  return (
    <ReviewWorkspace
      department="EEA"
      title="BVB-EEA Prüfungen"
      subtitle="Übersicht der EEA-Prüfungen"
      prueferLabel="EEA-Prüfer"
    />
  );
}
