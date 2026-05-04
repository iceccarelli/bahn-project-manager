import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, FolderOpen, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { useStats } from "@/hooks/useData";

export default function Dashboard() {
  const { data: stats, isLoading } = useStats();

  if (isLoading || !stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totalReviews = stats.statusDistribution.reduce((sum, s) => sum + Number(s.count), 0);
  const approvedCount = stats.statusDistribution.find(s => s.status === 'Zustimmung erteilt')?.count ?? 0;
  const openCount = stats.statusDistribution.find(s => s.status === 'offen')?.count ?? 0;
  const inProgressCount = stats.statusDistribution.find(s => s.status === 'in Bearbeitung')?.count ?? 0;

  const departments = Array.from(new Set(stats.departmentStats.map(d => d.department)));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Übersicht aller Bahnhofsprojekte und Prüfstatus
        </p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Projekte gesamt</CardTitle>
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.totalProjects.toLocaleString('de-DE')}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Zustimmung erteilt</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600 dark:text-green-400">{Number(approvedCount).toLocaleString('de-DE')}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {totalReviews > 0 ? ((Number(approvedCount) / totalReviews) * 100).toFixed(1) : 0}% aller Prüfungen
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Offen</CardTitle>
            <Clock className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-amber-600 dark:text-amber-400">{Number(openCount).toLocaleString('de-DE')}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Ausstehende Prüfungen
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">In Bearbeitung</CardTitle>
            <AlertTriangle className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">{Number(inProgressCount).toLocaleString('de-DE')}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Aktive Prüfvorgänge
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Region Stats & Prüfer Workload */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Projekte pro Region</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats.regionStats
                .filter(r => r.region)
                .sort((a, b) => Number(b.count) - Number(a.count))
                .slice(0, 10)
                .map(region => {
                  const percentage = (Number(region.count) / stats.totalProjects) * 100;
                  return (
                    <div key={region.region} className="flex items-center gap-3">
                      <span className="text-sm w-32 truncate text-muted-foreground">{region.region}</span>
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium w-10 text-right">{Number(region.count)}</span>
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Prüfer-Workload (Top 10)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats.prueferWorkload.slice(0, 10).map(pruefer => {
                const maxCount = Number(stats.prueferWorkload[0]?.count ?? 1);
                const percentage = (Number(pruefer.count) / maxCount) * 100;
                return (
                  <div key={pruefer.name} className="flex items-center gap-3">
                    <span className="text-sm w-28 truncate text-muted-foreground">{pruefer.name}</span>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-chart-1 rounded-full transition-all"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium w-12 text-right">{Number(pruefer.count)}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Status Distribution per Department */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status-Verteilung nach Fachbereich</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-2 font-medium text-muted-foreground">Fachbereich</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Zustimmung</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Offen</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">In Bearb.</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Nicht erf.</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Sonstige</th>
                </tr>
              </thead>
              <tbody>
                {departments.map(dept => {
                  const deptData = stats.departmentStats.filter(d => d.department === dept);
                  const approved = Number(deptData.find(d => d.status === 'Zustimmung erteilt')?.count ?? 0);
                  const open = Number(deptData.find(d => d.status === 'offen')?.count ?? 0);
                  const inProgress = Number(deptData.find(d => d.status === 'in Bearbeitung')?.count ?? 0);
                  const notRequired = Number(deptData.find(d => d.status === 'nicht erforderlich')?.count ?? 0);
                  const other = deptData
                    .filter(d => !['Zustimmung erteilt', 'offen', 'in Bearbeitung', 'nicht erforderlich'].includes(d.status || ''))
                    .reduce((sum, d) => sum + Number(d.count), 0);

                  return (
                    <tr key={dept} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="py-2 px-2 font-medium">{dept}</td>
                      <td className="py-2 px-2 text-right text-green-600 dark:text-green-400">{approved || '-'}</td>
                      <td className="py-2 px-2 text-right text-amber-600 dark:text-amber-400">{open || '-'}</td>
                      <td className="py-2 px-2 text-right text-blue-600 dark:text-blue-400">{inProgress || '-'}</td>
                      <td className="py-2 px-2 text-right text-muted-foreground">{notRequired || '-'}</td>
                      <td className="py-2 px-2 text-right">{other || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
