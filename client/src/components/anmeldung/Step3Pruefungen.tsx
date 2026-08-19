import { Unterschriftenblatt } from "./Unterschriftenblatt";
import { CHECKLIST_BY_KEY } from "@shared/checklist";
import type { ChecklistDraft } from "@/hooks/useChecklistDraft";

export function Step3Pruefungen({ draft }: { draft: ChecklistDraft }) {
  const { reviews, notified, header, requiredCount, answers } = draft;
  const open = reviews.filter((r) => r.status === "offen");
  const closed = reviews.filter((r) => r.status !== "offen");

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="space-y-5">
        <div>
          <h3 className="text-sm font-black tracking-tight">
            Automatisch erzeugte Fachprüfungen
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Aus den Antworten der Checkliste entstehen immer alle 14 Prüfzeilen —{" "}
            <strong className="font-bold text-foreground">{requiredCount}</strong> mit dem Status
            „offen", {closed.length} als „nicht erforderlich". Das entspricht der Struktur der
            bestehenden 18.172 Prüfzeilen.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <div className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-[#FF0000]">
              Prüfung offen ({open.length})
            </div>
            {open.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">
                Keine — mit dieser Checkliste ist keine Fachprüfung erforderlich.
              </p>
            ) : (
              <ul className="space-y-1">
                {open.map((r) => {
                  const q = CHECKLIST_BY_KEY[r.decidedBy];
                  return (
                    <li
                      key={r.department}
                      className="flex items-baseline justify-between gap-3 rounded-md border border-[#FF0000]/30 bg-[#FF0000]/5 px-3 py-1.5"
                    >
                      <span className="text-xs font-black">{r.department}</span>
                      <span className="text-right text-[10px] leading-tight text-muted-foreground">
                        Nr. {q?.nr} · {q?.gewerk}
                        {r.viaSecondary && (
                          <span className="ml-1 font-bold text-[#FF0000]">(2. Frage)</span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div>
            <div className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              Nicht erforderlich ({closed.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {closed.map((r) => (
                <span
                  key={r.department}
                  className="rounded border border-border bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground"
                >
                  {r.department}
                </span>
              ))}
            </div>
          </div>

          {notified.length > 0 && (
            <div>
              <div className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-500">
                Zusätzlich zu informieren ({notified.length})
              </div>
              <ul className="space-y-1 text-[11px]">
                {notified.map((key) => (
                  <li key={key} className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 dark:border-amber-800/70 dark:bg-amber-950/40">
                    <strong className="font-black">{CHECKLIST_BY_KEY[key]?.gewerk}</strong>
                    <span className="ml-2 text-muted-foreground">
                      keine eigene Prüfspalte — wird benachrichtigt
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {answers.freischaltungFaa?.answer === "Erforderlich" && (
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
              Freischaltung FAA ist als <strong className="text-foreground">Erforderlich</strong>{" "}
              markiert. Der Versand der FAA-Mail folgt in Stufe 4.
            </p>
          )}
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-black tracking-tight">Unterschriftenblatt — Vorschau</h3>
        <Unterschriftenblatt
          projektnummer={header.projektnummer}
          projektbezeichnung={header.projektbezeichnung}
          projektleitung={header.projektleitung}
          reviews={reviews}
        />
      </div>
    </div>
  );
}
