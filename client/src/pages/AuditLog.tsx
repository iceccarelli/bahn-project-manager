import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { History, Search, Trash2, FilePlus2, PencilLine, ClipboardCheck } from "lucide-react";
import { useAuditLog } from "@/hooks/useDataQuery";

/**
 * Änderungshistorie.
 *
 * This page used to be a placeholder: a centred icon and a paragraph reading
 * "Alle Bearbeitungen in dieser Sitzung werden hier protokolliert." It never
 * called useAuditLog(). Every edit *was* being written — action, details with
 * the old and new value, user and ISO timestamp — and nothing ever read them
 * back. The empty state looked deliberate, which is why it survived: the page
 * did not appear broken, it appeared quiet.
 */

/** Icon and tone per action verb, so the log is scannable rather than a wall of text. */
function actionStyle(action: string) {
  if (/gelöscht|entfernt/i.test(action))
    return { Icon: Trash2, tone: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" };
  if (/angelegt|erstellt|Anmeldung/i.test(action))
    return { Icon: FilePlus2, tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" };
  if (/Prüfung|Review/i.test(action))
    return { Icon: ClipboardCheck, tone: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300" };
  return { Icon: PencilLine, tone: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" };
}

const dateFmt = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit", month: "2-digit", year: "numeric",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});

function formatStamp(iso: string): string {
  const d = new Date(iso);
  // Never render "Invalid Date" at the user: show what was stored instead.
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

export default function AuditLogPage() {
  const { data: entries, isLoading } = useAuditLog();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const all = entries ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((e) =>
      `${e.action} ${e.details} ${e.user}`.toLowerCase().includes(q),
    );
  }, [entries, query]);

  const total = entries?.length ?? 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Änderungshistorie</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Protokoll aller Änderungen an Projekten und Prüfungen
          </p>
        </div>
        <div className="relative w-full sm:w-80">
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Änderungshistorie durchsuchen"
            placeholder="Aktion, Feld oder Person …"
            className="h-10 pl-9"
          />
        </div>
      </header>

      {/* <output> carries an implicit role=status, so the count is announced
          when the filter changes without an explicit ARIA role. */}
      <output className="block text-xs text-muted-foreground">
        {isLoading
          ? "wird geladen …"
          : query
            ? `${filtered.length} von ${total} Einträgen`
            : `${total} ${total === 1 ? "Eintrag" : "Einträge"}`}
      </output>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-20">
            <div className="flex flex-col items-center justify-center space-y-4 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <History className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-semibold">
                  {total === 0 ? "Noch keine Änderungen" : "Kein Treffer"}
                </h2>
                <p className="mx-auto max-w-md text-sm text-muted-foreground">
                  {total === 0
                    ? "Sobald ein Projekt bearbeitet oder eine Prüfung geändert wird, erscheint der Vorgang hier."
                    : `Kein Eintrag enthält „${query}".`}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">
                Änderungshistorie — Zeitpunkt, Person, Aktion und Details je Vorgang
              </caption>
              <thead>
                <tr className="border-b bg-muted/40 text-2xs uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="px-4 py-2.5 text-left font-black">Zeitpunkt</th>
                  <th scope="col" className="px-4 py-2.5 text-left font-black">Person</th>
                  <th scope="col" className="px-4 py-2.5 text-left font-black">Aktion</th>
                  <th scope="col" className="px-4 py-2.5 text-left font-black">Details</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => {
                  const { Icon, tone } = actionStyle(e.action);
                  return (
                    <tr key={e.id} className="border-b border-border/60 align-top hover:bg-muted/30">
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-2xs text-muted-foreground">
                        {formatStamp(e.timestamp)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs font-medium">{e.user}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-2xs font-medium ${tone}`}
                        >
                          <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
                          {e.action}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs leading-snug">{e.details}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
