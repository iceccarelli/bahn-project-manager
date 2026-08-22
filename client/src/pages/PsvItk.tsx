import { ReviewWorkspace } from "@/components/workspace/ReviewWorkspace";

/**
 * The date column was headed "Datum" on a page titled "Projektvorstellungen",
 * while it renders the ITK Prüfdatum. Measured over the 510 listed rows the two
 * fields differ on 355 and agree on 126, and 73 rows show "—" for a project
 * that does have a Termin on file — so a reader taking "Datum" as the
 * Projektvorstellung date was wrong two times in three. The shared workspace
 * labels it "Prüfdatum", which is what it is.
 */
export default function PsvItk() {
  return (
    <ReviewWorkspace
      department="ITK"
      title="PSV-ITK Prüfungen"
      subtitle="Übersicht der ITK-Prüfungen"
      prueferLabel="ITK-Prüfer"
    />
  );
}
