import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { useAllData } from "@/hooks/useDataQuery";

export default function PsvItk() {
  const { data, isLoading } = useAllData();

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Filter projects that have ITK reviews with a status
  const itkProjects = data.projects.filter((p: any) => {
    const itkReview = p.reviews?.find((r: any) => r.department === 'ITK');
    return itkReview && itkReview.status && itkReview.status !== 'nicht erforderlich';
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">PSV-ITK Projektvorstellungen</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Verwaltung der ITK-Projektvorstellungen &bull; {itkProjects.length} Einträge
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
                  <th className="text-left py-2.5 px-3 font-medium text-muted-foreground whitespace-nowrap">ITK-Prüfer</th>
                  <th className="text-left py-2.5 px-3 font-medium text-muted-foreground whitespace-nowrap">Datum</th>
                  <th className="text-left py-2.5 px-3 font-medium text-muted-foreground whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody>
                {itkProjects.map((item: any) => {
                  const itkReview = item.reviews?.find((r: any) => r.department === 'ITK');
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
                        {itkReview?.prueferName || '-'}
                      </td>
                      <td className="py-2 px-3 text-xs whitespace-nowrap">
                        {itkReview?.pruefDatum ? new Date(itkReview.pruefDatum).toLocaleDateString('de-DE') : '-'}
                      </td>
                      <td className="py-2 px-3 text-xs whitespace-nowrap">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          itkReview?.status === 'Zustimmung erteilt' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' :
                          itkReview?.status === 'offen' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' :
                          itkReview?.status === 'in Bearbeitung' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' :
                          'bg-muted text-muted-foreground'
                        }`}>
                          {itkReview?.status || '-'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {itkProjects.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-muted-foreground">
                      Keine PSV-ITK Einträge vorhanden.
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
