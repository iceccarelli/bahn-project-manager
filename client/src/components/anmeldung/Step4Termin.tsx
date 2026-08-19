import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ChecklistDraft } from "@/hooks/useChecklistDraft";
import { useSchedule, type ResolvedSlot } from "@/hooks/useSchedule";
import { formatGerman } from "@shared/date";

const STATUS_STYLE: Record<string, string> = {
  Frei: "border-emerald-400 bg-emerald-50 text-emerald-900 hover:border-emerald-600 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
  Gebucht: "border-border bg-muted text-muted-foreground cursor-not-allowed",
  "Vorgebucht für IM":
    "border-amber-400 bg-amber-50 text-amber-900 cursor-not-allowed dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  "Vorgebucht für IT":
    "border-sky-400 bg-sky-50 text-sky-900 cursor-not-allowed dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
};

function Legend() {
  return (
    <div className="flex flex-wrap gap-4 text-[10px] font-bold">
      {(["Frei", "Gebucht", "Vorgebucht für IM", "Vorgebucht für IT"] as const).map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className={`h-3 w-3 rounded border ${STATUS_STYLE[s]?.split(" ").slice(0, 2).join(" ")}`} />
          {s}
        </span>
      ))}
    </div>
  );
}

export function Step4Termin({ draft }: { draft: ChecklistDraft }) {
  const { termin, setTermin, mode, answers, stepIssues, header } = draft;
  const [weeks, setWeeks] = useState(8);
  const { days, freeCount, isLoading, todayIso } = useSchedule();

  const ohneVorstellung =
    answers.mitProjektvorstellung?.answer === "Nein" || mode === "Projektkonfiguration";

  const shown = useMemo(() => days.slice(0, weeks), [days, weeks]);
  const error = stepIssues[4]?.[0]?.message;

  if (ohneVorstellung) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs dark:border-amber-800/70 dark:bg-amber-950/40">
        <strong className="font-black">Keine Terminbuchung erforderlich.</strong>{" "}
        {mode === "Projektkonfiguration"
          ? "Im Modus Projektkonfiguration entfällt die Projektvorstellung."
          : 'Die Frage „Projekt mit Projektvorstellung anmelden?" ist mit „Nein" beantwortet — das ist nur nach vorheriger Abstimmung mit Fachspezialisten und TBQ zulässig.'}
        {answers.mitProjektvorstellung?.comment && (
          <div className="mt-1.5">
            Übergabe der Unterlagen:{" "}
            <strong className="font-bold">{answers.mitProjektvorstellung.comment}</strong>
          </div>
        )}
      </div>
    );
  }

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">Termine werden geladen…</p>;
  }

  const slotButton = (s: ResolvedSlot) => {
    const selected = termin?.slotId === s.id;
    const style = STATUS_STYLE[s.effectiveStatus] ?? STATUS_STYLE.Gebucht;
    return (
      <button
        key={s.id}
        type="button"
        disabled={!s.selectable}
        aria-pressed={selected}
        onClick={() =>
          setTermin(
            selected ? null : { slotId: s.id, datum: s.datum, von: s.von, bis: s.bis },
          )
        }
        title={s.info ?? s.hinweis ?? undefined}
        className={`flex min-w-[104px] flex-col items-start gap-0.5 rounded-md border px-2.5 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF0000] focus-visible:ring-offset-1 ${style} ${
          selected ? "ring-2 ring-[#FF0000] ring-offset-1" : ""
        }`}
      >
        <span className="text-[11px] font-black tabular-nums">
          {s.von}–{s.bis}
        </span>
        <span className="text-[9px] font-bold uppercase tracking-wide opacity-80">
          {s.effectiveStatus}
        </span>
        {s.unavailable.length > 0 && (
          <span className="text-[9px] leading-tight opacity-80">
            ohne {s.unavailable.join(", ")}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs">
          <strong className="font-black">{freeCount}</strong> freie Termine in den nächsten 180
          Tagen · Fachspezialistenprüfung findet dienstags statt
        </div>
        <Legend />
      </div>

      {error && (
        <p className="rounded-md border border-[#FF0000]/40 bg-[#FF0000]/5 px-3 py-2 text-xs font-bold text-[#FF0000]">
          {error}
        </p>
      )}

      <div className="space-y-3">
        {shown.map((day) => {
          const hasFree = day.slots.some((s) => s.selectable);
          return (
            <div key={day.datum} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-baseline gap-3">
                <span className="text-xs font-black tabular-nums">{formatGerman(day.datum)}</span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {day.datum === todayIso ? "heute" : "Dienstag"}
                </span>
                {!hasFree && (
                  <span className="text-[10px] font-bold text-muted-foreground">
                    keine freien Termine
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">{day.slots.map(slotButton)}</div>
            </div>
          );
        })}
      </div>

      {weeks < days.length && (
        <Button variant="outline" onClick={() => setWeeks((w) => w + 8)} className="text-xs">
          Weitere Termine anzeigen ({days.length - weeks} Wochen)
        </Button>
      )}

      {termin && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-[#FF0000] bg-[#FF0000]/5 px-4 py-3">
          <div className="text-xs">
            <div className="font-black">
              Gewählt: {formatGerman(termin.datum)} · {termin.von}–{termin.bis}
            </div>
            <div className="mt-0.5 text-muted-foreground">
              Wird bei der Anmeldung gebucht als „{header.projektleitung || "—"} -{" "}
              {header.stationsname || "—"} - {header.projektstand || "—"}"
            </div>
          </div>
          <Button variant="outline" onClick={() => setTermin(null)} className="text-xs">
            Auswahl aufheben
          </Button>
        </div>
      )}
    </div>
  );
}
