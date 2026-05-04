import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { useAllData } from "@/hooks/useData";

export default function BvbEea() {
  const { data, isLoading } = useAllData();

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Filter projects that have EEA reviews with a status
  const eaaProjects = data.projects.filter((p: any) => {
    const eaaReview = p.reviews?.find((r: any) => r.department === 'EEA');
    return eaaReview && eaaReview.status && eaaReview.status !== 'nicht erforderlich';
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">BVB-EEA Freigaben</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Verwaltung der EEA-Freigabeerklärungen &bull; {eaaProjects.length} Einträge
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left py-2.5 px-3 font-medium text-muted-foreground whitespace-nowrap">Projektnummer</th>
                  <th className="text-left py-2.5 px-3 font-medium text-muted-foreground whitespace-nowrap">Region</th>
                  <th className="text-left py-2.5 px-3 font-medium text-muted-foreground whitespace-nowrap">Station</th>
                  <th className="text-left py-2.5 px-3 font-medium text-muted-foreground whitespace-nowrap min-w-[200px]">Beschreibung</th>
                  <th className="text-left py-2.5 px-3 font-medium text-muted-foreground whitespace-nowrap">Projektleiter</th>
                  <th className="text-left py-2.5 px-3 font-medium text-muted-foreground whitespace-nowrap">EEA-Prüfer</th>
                  <th className="text-left py-2.5 px-3 font-medium text-muted-foreground whitespace-nowrap">Datum</th>
                  <th className="text-left py-2.5 px-3 font-medium text-muted-foreground whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody>
                {eaaProjects.map((item: any) => {
                  const eaaReview = item.reviews?.find((r: any) => r.department === 'EEA');
                  return (
                    <tr key={item.id} className="border-t hover:bg-muted/30 transition-colors">
                      <td className="py-2 px-3 font-mono text-xs whitespace-nowrap font-medium">
                        {item.projektnummer || '-'}
                      </td>
                      <td className="py-2 px-3 text-xs whitespace-nowrap">
                        {item.bahnhofsmanagement || '-'}
                      </td>
                      <td className="py-2 px-3 text-xs whitespace-nowrap font-medium">
                        {item.station || '-'}
                      </td>
                      <td className="py-2 px-3 text-xs max-w-[250px]">
                        <span className="line-clamp-2">{item.projektbeschreibung || '-'}</span>
                      </td>
                      <td className="py-2 px-3 text-xs whitespace-nowrap">
                        {item.projektleiter || '-'}
                      </td>
                      <td className="py-2 px-3 text-xs whitespace-nowrap">
                        {eaaReview?.prueferName || '-'}
                      </td>
                      <td className="py-2 px-3 text-xs whitespace-nowrap">
                        {eaaReview?.pruefDatum ? new Date(eaaReview.pruefDatum).toLocaleDateString('de-DE') : '-'}
                      </td>
                      <td className="py-2 px-3 text-xs whitespace-nowrap">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          eaaReview?.status === 'Zustimmung erteilt' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' :
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
                    <td colSpan={8} className="py-8 text-center text-muted-foreground">
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
