import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { useAllData } from "@/hooks/useDataQuery";

export default function BvbEea() {
  const { data, isLoading } = useAllData();

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-12 w-12 animate-spin text-[#FF0000]" />
          <p className="text-lg font-medium text-muted-foreground">Lade BVB-EEA Daten...</p>
        </div>
      </div>
    );
  }

  // Filter projects that have EEA reviews with a status
  const eaaProjects = data.projects.filter((p: any) => {
    const eaaReview = p.reviews?.find((r: any) => r.department === 'EEA');
    return eaaReview && eaaReview.status && eaaReview.status !== 'nicht erforderlich';
  });

  return (
    <div className="space-y-8 p-6 bg-background min-h-screen">
      {/* HEADER SECTION */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">BVB-EEA Freigaben</h1>
          <p className="text-muted-foreground mt-2">
            Verwaltung der EEA-Freigabeerklärungen &bull; {eaaProjects.length} Einträge
          </p>
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <Card className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <CardContent className="p-0">
          <div className="table-scroll-container">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-muted/50 sticky top-0 z-10">
                <tr>
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground whitespace-nowrap border-b">Projektnummer</th>
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground whitespace-nowrap border-b">Region</th>
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground whitespace-nowrap border-b">Station</th>
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground whitespace-nowrap border-b min-w-[250px]">Beschreibung</th>
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground whitespace-nowrap border-b">Projektleiter</th>
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground whitespace-nowrap border-b">EEA-Prüfer</th>
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground whitespace-nowrap border-b">Datum</th>
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground whitespace-nowrap border-b">Status</th>
                </tr>
              </thead>
              <tbody>
                {eaaProjects.map((item: any) => {
                  const eaaReview = item.reviews?.find((r: any) => r.department === 'EEA');
                  return (
                    <tr key={item.id} className="border-b hover:bg-muted/30 transition-colors">
                      <td className="py-3 px-4 font-mono text-xs whitespace-nowrap font-medium">
                        {item.projektnummer || '-'}
                      </td>
                      <td className="py-3 px-4 text-xs whitespace-nowrap">
                        {item.bahnhofsmanagement || '-'}
                      </td>
                      <td className="py-3 px-4 text-xs whitespace-nowrap font-medium">
                        {item.station || '-'}
                      </td>
                      <td className="py-3 px-4 text-xs max-w-[300px]">
                        <span className="line-clamp-2">{item.projektbeschreibung || '-'}</span>
                      </td>
                      <td className="py-3 px-4 text-xs whitespace-nowrap">
                        {item.projektleiter || '-'}
                      </td>
                      <td className="py-3 px-4 text-xs whitespace-nowrap">
                        {eaaReview?.prueferName || '-'}
                      </td>
                      <td className="py-3 px-4 text-xs whitespace-nowrap">
                        {eaaReview?.pruefDatum ? new Date(eaaReview.pruefDatum).toLocaleDateString('de-DE') : '-'}
                      </td>
                      <td className="py-3 px-4 text-xs whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-medium ${
                          eaaReview?.status === 'Zustimmung erteilt' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' :
                          eaaReview?.status === 'offen' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' :
                          eaaReview?.status === 'in Bearbeitung' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' :
                          'bg-muted text-muted-foreground'
                        }`}>
                          {eaaReview?.status || '-'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {eaaProjects.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-muted-foreground">
                      Keine BVB-EEA Einträge vorhanden.
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
