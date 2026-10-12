import { Suspense, lazy } from "react";
import { useLocation, useSearch } from "wouter";
import { ReviewWorkspace } from "@/components/workspace/ReviewWorkspace";
import { ServerDepartmentView } from "@/components/workspace/ServerDepartmentView";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SERVER_MODE } from "@/realtime/serverApi";

/**
 * The date column was headed "Datum" on a page titled "Projektvorstellungen",
 * while it renders the ITK Prüfdatum. Measured over the 510 listed rows the two
 * fields differ on 355 and agree on 126, and 73 rows show "—" for a project
 * that does have a Termin on file — so a reader taking "Datum" as the
 * Projektvorstellung date was wrong two times in three. The shared workspace
 * labels it "Prüfdatum", which is what it is.
 */
function Uebersicht() {
  // Server mode: the same Project aggregate, filtered to this Gewerk — one data plane, one permission model.
  if (SERVER_MODE) return <ServerDepartmentView department="ITK" title="PSV-ITK Prüfungen" subtitle="Übersicht der ITK-Prüfungen" prueferLabel="ITK-Prüfer" />;
  return (
    <ReviewWorkspace
      department="ITK"
      title="PSV-ITK Prüfungen"
      subtitle="Übersicht der ITK-Prüfungen"
      prueferLabel="ITK-Prüfer"
    />
  );
}

/** Own chunk: the checklists and their UI are not paid for by anyone who only reads the Übersicht. */
const AbnahmeView = lazy(() => import("@/components/abnahme/AbnahmeView"));
/** Own chunk as well: Recharts and the year derivation load only for readers who open the Jahresansicht. */
const JahresansichtView = lazy(() => import("@/components/itk/JahresansichtView"));

function TabFallback({ label }: { label: string }) {
  return <div className="m-6 min-h-[60vh] animate-pulse rounded-xl bg-muted/40" role="status" aria-live="polite" aria-label={`${label} wird geladen`} />;
}

/**
 * The sections of /psv-itk. The tab is in the URL (`?tab=abnahme`), so it can be
 * linked, reloaded and navigated back to; the Übersicht is the default and keeps
 * its own query parameters (`q`, `tone`, `view`).
 *
 * Where the Projektübersicht ITK platform lands (docs/itk-platform.md): its
 * yearly tabs and dashboard are the Jahresansicht; its Technik view and PDF-Code
 * need the Prüfbericht record (Technik, Tätigkeitsbereich, laufende Nummer), which
 * this app does not hold yet. They become further entries here — one `value`, one
 * label, one panel — when that data exists. A tab that opens a placeholder is a
 * worse promise than no tab.
 */
const TABS = [
  { value: "uebersicht", label: "Übersicht" },
  { value: "jahresansicht", label: "Jahresansicht" },
  { value: "abnahme", label: "Abnahme" },
] as const;
type PsvItkTab = (typeof TABS)[number]["value"];

const isTab = (value: string | null): value is PsvItkTab => TABS.some((t) => t.value === value);

export default function PsvItk() {
  const [pathname, navigate] = useLocation();
  const search = useSearch();
  const raw = new URLSearchParams(search).get("tab");
  const tab: PsvItkTab = isTab(raw) ? raw : "uebersicht";

  const select = (next: string) => {
    if (!isTab(next)) return;
    const params = new URLSearchParams(search);
    if (next === "uebersicht") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    navigate(qs ? `${pathname}?${qs}` : pathname, { replace: true });
  };

  return (
    <Tabs value={tab} onValueChange={select} className="gap-0">
      <div className="px-6 pt-6">
        <TabsList aria-label="PSV-ITK Bereiche">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="px-4">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {/* Kept mounted while hidden: filters, sort and scroll of the Übersicht survive a visit to the Abnahme. */}
      <TabsContent value="uebersicht" forceMount className="mt-0 data-[state=inactive]:hidden">
        <Uebersicht />
      </TabsContent>
      <TabsContent value="jahresansicht" className="mt-0">
        <Suspense fallback={<TabFallback label="Jahresansicht" />}>
          <JahresansichtView />
        </Suspense>
      </TabsContent>
      <TabsContent value="abnahme" className="mt-0">
        <Suspense fallback={<TabFallback label="Abnahme" />}>
          <AbnahmeView />
        </Suspense>
      </TabsContent>
    </Tabs>
  );
}
