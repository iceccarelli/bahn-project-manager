import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, FolderOpen, CheckCircle2, Clock, AlertTriangle, Inbox, Edit3, Mail, MessageSquare } from "lucide-react";
import { useStats, useRecentArrivals, useRecentInBearbeitung } from "@/hooks/useData";
import { toast } from "sonner";

export default function Dashboard() {
  const { data: stats, isLoading } = useStats();
  const { data: recentArrivals, isLoading: arrivalsLoading } = useRecentArrivals(5);
  const { data: recentInBearbeitung, isLoading: inBearbLoading } = useRecentInBearbeitung(5);

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

  const handleEmailNotify = (section: 'arrival' | 'bearbeitung') => {
    const items = section === 'arrival' ? recentArrivals : recentInBearbeitung;
    let subject = '';
    let body = '';
    if (section === 'arrival') {
      subject = 'Neue Projekte / Prüfungen angekommen - Dashboard Benachrichtigung';
      body = `Hallo Fachspezialist,\n\nDie folgenden neuen Projekte/Prüfungen sind gerade angekommen:\n\n` +
        items.map((item, idx) => `${idx + 1}. Projektleiter: ${item.projektleiter}\n   Projekt: ${item.projekt}\n   Gewerke: ${item.gewerke}\n`).join('\n') +
        `\nBitte prüfen und übernehmen.\n\nMit freundlichen Grüßen\nIhr Dashboard`;
    } else {
      subject = 'Projekte in Bearbeitung - Fristen & Status prüfen';
      body = `Hallo,\n\nFolgende Projekte sind aktuell in Bearbeitung:\n\n` +
        items.map((item, idx) => `${idx + 1}. Fachspezialist: ${item.fachspezialist}\n   Projekt: ${item.projekt}\n   Seit: ${item.seitWann} | Abgabe: ${item.abgabeWann}\n`).join('\n') +
        `\nBitte um zeitnahe Rückmeldung.\n\nMit freundlichen Grüßen\nIhr Dashboard`;
    }
    const mailtoLink = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoLink;
    toast.success('E-Mail Client geöffnet', {
      description: 'Die Nachricht wurde vorausgefüllt mit den aktuellen Daten.',
    });
  };

  const handleTeamsNotify = (section: 'arrival' | 'bearbeitung') => {
    const items = section === 'arrival' ? recentArrivals : recentInBearbeitung;
    let message = '';
    if (section === 'arrival') {
      message = `**🆕 Gerade angekommen - Dashboard Update**\n\n` +
        items.map((item, idx) => `**${idx + 1}.** ${item.projektleiter} | ${item.projekt}\n   Gewerke: ${item.gewerke}`).join('\n\n') +
        `\n\nBitte prüfen und ggf. übernehmen. Danke!`;
    } else {
      message = `**⚙️ Gerade in Bearbeitung - Dashboard Update**\n\n` +
        items.map((item, idx) => `**${idx + 1}.** Fachspezialist: ${item.fachspezialist}\n   Projekt: ${item.projekt}\n   Seit: ${item.seitWann} | Abgabe: ${item.abgabeWann}`).join('\n\n') +
        `\n\nBitte prüfen und Rückmeldung geben. Danke!`;
    }
    navigator.clipboard.writeText(message).then(() => {
      toast.success('Teams-Nachricht kopiert!', {
        description: 'In Microsoft Teams einfügen und an den/die Fachspezialisten senden.',
      });
    }).catch(() => {
      toast.error('Kopieren fehlgeschlagen', { description: 'Bitte manuell kopieren.' });
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Übersicht aller Bahnhofsprojekte und Prüfstatus (inkl. BS)
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

      {/* Gerade angekommen & Gerade in Bearbeitung - Neue Sektionen mit Notify Buttons */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. Gerade angekommen: letzte 5 neue */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Gerade angekommen</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">Die letzten 5 neuen Projekte / Prüfungen</p>
              </div>
              <Inbox className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {arrivalsLoading ? (
              <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : recentArrivals.length > 0 ? (
              <div className="space-y-2.5 text-sm">
                {recentArrivals.map((item, index) => (
                  <div key={index} className="flex items-start gap-3 border-b pb-2 last:border-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{item.projektleiter}</div>
                      <div className="text-xs text-muted-foreground truncate">{item.projekt}</div>
                      <div className="text-[10px] text-blue-600 dark:text-blue-400 mt-0.5">Gewerke: {item.gewerke}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground py-2">Keine aktuellen Daten verfügbar.</p>
            )}
            <div className="flex flex-wrap gap-2 mt-4">
              <Button 
                size="sm" 
                className="flex-1 sm:flex-none gap-1.5"
                onClick={() => handleEmailNotify('arrival')}
              >
                <Mail className="h-3.5 w-3.5" /> Email to notify Fachspezialist
              </Button>
              <Button 
                size="sm" 
                variant="outline" 
                className="flex-1 sm:flex-none gap-1.5"
                onClick={() => handleTeamsNotify('arrival')}
              >
                <MessageSquare className="h-3.5 w-3.5" /> Teams Message to notify
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 2. Gerade in Bearbeitung: letzte 5 neue bei Fachspezialist */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Gerade in Bearbeitung</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">Letzte 5 neue beim Fachspezialisten in Bearbeitung</p>
              </div>
              <Edit3 className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {inBearbLoading ? (
              <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : recentInBearbeitung.length > 0 ? (
              <div className="space-y-2.5 text-sm">
                {recentInBearbeitung.map((item, index) => (
                  <div key={index} className="flex items-start gap-3 border-b pb-2 last:border-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{item.fachspezialist}</div>
                      <div className="text-xs text-muted-foreground truncate">{item.projekt}</div>
                      <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">Seit: {item.seitWann} | Abgabe: {item.abgabeWann}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground py-2">Keine aktuellen Daten verfügbar.</p>
            )}
            <div className="flex flex-wrap gap-2 mt-4">
              <Button 
                size="sm" 
                className="flex-1 sm:flex-none gap-1.5"
                onClick={() => handleEmailNotify('bearbeitung')}
              >
                <Mail className="h-3.5 w-3.5" /> Email to notify Fachspezialist
              </Button>
              <Button 
                size="sm" 
                variant="outline" 
                className="flex-1 sm:flex-none gap-1.5"
                onClick={() => handleTeamsNotify('bearbeitung')}
              >
                <MessageSquare className="h-3.5 w-3.5" /> Teams Message to notify
              </Button>
            </div>
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

      {/* Status Distribution per Department - includes BS */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status-Verteilung nach Fachbereich (inkl. BS)</CardTitle>
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
