import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ChecklistDraft } from "@/hooks/useChecklistDraft";
import { FREISCHALTUNG_OPTIONS, JA_NEIN, type ChecklistQuestion } from "@shared/checklist";

const YELLOW =
  "bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800/70 focus-visible:ring-amber-400";

/**
 * Ja/Nein as a real radio group rather than a select: two options, always
 * visible, one keystroke to answer, and screen readers get the question as the
 * group label.
 */
function JaNein({
  name,
  legend,
  value,
  onChange,
  invalid,
}: {
  name: string;
  legend: string;
  value: string | null | undefined;
  onChange: (v: string) => void;
  invalid?: boolean;
}) {
  return (
    <fieldset className="flex gap-1" aria-invalid={invalid}>
      <legend className="sr-only">{legend}</legend>
      {JA_NEIN.map((option) => {
        const id = `${name}-${option}`;
        const checked = value === option;
        return (
          <div key={option}>
            <input
              type="radio"
              id={id}
              name={name}
              value={option}
              checked={checked}
              onChange={() => onChange(option)}
              className="peer sr-only"
            />
            <label
              htmlFor={id}
              className={`inline-flex h-7 w-12 cursor-pointer items-center justify-center rounded-md border text-[11px] font-bold transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[#FF0000] peer-focus-visible:ring-offset-1 ${
                checked
                  ? option === "Ja"
                    ? "border-[#FF0000] bg-[#FF0000] text-white"
                    : "border-border bg-muted text-foreground"
                  : `${YELLOW} text-muted-foreground hover:border-[#FF0000]/50`
              }`}
            >
              {option}
            </label>
          </div>
        );
      })}
    </fieldset>
  );
}

export function Step2Checkliste({ draft }: { draft: ChecklistDraft }) {
  const { questions, answers, setAnswer, stepIssues, reviews, requiredCount } = draft;
  const issueFor = (key: string) => stepIssues[2]?.find((i) => i.field === key)?.message;

  const gewerke = questions.filter((q) => q.kind === "gewerk");
  const admin = questions.filter((q) => q.kind === "admin");
  const notes = questions.find((q) => q.kind === "notes");

  const renderAnswer = (q: ChecklistQuestion) => {
    const a = answers[q.key];
    const invalid = Boolean(issueFor(q.key));
    if (q.answerType === "jaNein") {
      return (
        <JaNein
          name={q.key}
          legend={`Nr. ${q.nr} — ${q.gewerk}`}
          value={a?.answer}
          onChange={(v) => setAnswer(q.key, { answer: v })}
          invalid={invalid}
        />
      );
    }
    if (q.answerType === "freischaltung") {
      return (
        <Select
          value={
            a?.answer && (FREISCHALTUNG_OPTIONS as readonly string[]).includes(a.answer)
              ? a.answer
              : undefined
          }
          onValueChange={(v) => setAnswer(q.key, { answer: v })}
        >
          <SelectTrigger className={`h-7 w-[190px] text-[11px] ${YELLOW}`} aria-label={q.gewerk}>
            <SelectValue placeholder="Bitte auswählen" />
          </SelectTrigger>
          <SelectContent>
            {FREISCHALTUNG_OPTIONS.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    return (
      <Input
        className={`h-7 w-[260px] text-[11px] ${YELLOW}`}
        aria-label={q.question ?? q.gewerk}
        placeholder={q.key === "pkpLink" ? "https://…" : ""}
        value={a?.answer && a.answer !== "Bitte ausfüllen" ? a.answer : ""}
        onChange={(e) => setAnswer(q.key, { answer: e.target.value })}
      />
    );
  };

  const Row = ({ q }: { q: ChecklistQuestion }) => {
    const a = answers[q.key];
    const error = issueFor(q.key);
    const triggersReview = q.department !== null;
    const isOpen = reviews.find((r) => r.department === q.department)?.status === "offen";
    return (
      <tr className="border-b border-border/60 align-top hover:bg-muted/30">
        <td className="w-10 py-2 pr-2 text-[10px] font-black text-muted-foreground">{q.nr}</td>
        <td className="w-56 py-2 pr-3">
          <div className="text-[11px] font-bold leading-tight">{q.gewerk}</div>
          {triggersReview && (
            <div
              className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                isOpen ? "bg-[#FF0000]/10 text-[#FF0000]" : "bg-muted text-muted-foreground"
              }`}
            >
              {q.department} · {isOpen ? "Prüfung offen" : "nicht erforderlich"}
            </div>
          )}
        </td>
        <td className="py-2 pr-3 text-[11px] leading-snug text-muted-foreground">
          {q.question ? (
            q.question.split("\n").map((line) => <div key={line}>{line}</div>)
          ) : (
            <span className="italic">Keine Fragestellung im Formular hinterlegt</span>
          )}
          {q.hint && !q.secondary && (
            <div className="mt-1 text-[10px] italic opacity-80">{q.hint}</div>
          )}
        </td>
        <td className="w-[200px] py-2 pr-3">
          {renderAnswer(q)}
          {q.secondary && (
            <div className="mt-2">
              <div className="mb-1 text-[10px] font-bold leading-tight text-muted-foreground">
                {q.secondary.label.split("\n").join(" ")}
              </div>
              <JaNein
                name={`${q.key}-secondary`}
                legend={`${q.gewerk} — ${q.secondary.label}`}
                value={a?.secondary}
                onChange={(v) => setAnswer(q.key, { secondary: v as "Ja" | "Nein" })}
              />
            </div>
          )}
          <p className="min-h-[14px] text-[10px] font-bold leading-[14px] text-[#FF0000]">
            {error ?? ""}
          </p>
        </td>
        <td className="w-[220px] py-2">
          <Input
            className="h-7 text-[11px]"
            aria-label={`Kommentar zu Nr. ${q.nr}`}
            placeholder={
              q.key === "mitProjektvorstellung" ? "Datum der Übergabe (bei Nein)" : "Kommentar"
            }
            value={a?.comment ?? ""}
            onChange={(e) => setAnswer(q.key, { comment: e.target.value })}
          />
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-xs">
        <span>
          <strong className="font-black">{requiredCount}</strong> von 14 Gewerken erfordern eine
          Prüfung
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">
          Eine Prüfung entsteht, wenn die Antwort „Ja" ist — bei ITK, Elektrotechnik und Brandschutz
          genügt auch die zweite Frage.
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <caption className="sr-only">
            Checkliste zur Projektanmeldung — 22 Fragen aus dem Formular
          </caption>
          <thead>
            <tr className="border-y border-border text-[9px] uppercase tracking-wider text-muted-foreground">
              <th scope="col" className="py-1.5 text-left font-black">
                Nr.
              </th>
              <th scope="col" className="py-1.5 text-left font-black">
                Gewerk
              </th>
              <th scope="col" className="py-1.5 text-left font-black">
                Frage zum Projekt
              </th>
              <th scope="col" className="py-1.5 text-left font-black">
                Antwort
              </th>
              <th scope="col" className="py-1.5 text-left font-black">
                Kommentar
              </th>
            </tr>
          </thead>
          <tbody>
            {admin.length > 0 && (
              <tr>
                <td colSpan={5} className="pt-3 pb-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  Allgemein
                </td>
              </tr>
            )}
            {admin.map((q) => (
              <Row key={q.key} q={q} />
            ))}
            <tr>
              <td colSpan={5} className="pt-4 pb-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                Gewerke
              </td>
            </tr>
            {gewerke.map((q) => (
              <Row key={q.key} q={q} />
            ))}
          </tbody>
        </table>
      </div>

      {notes && (
        <div className="space-y-1.5">
          <label htmlFor="anmerkungen" className="block text-xs font-bold">
            {notes.gewerk}
          </label>
          <textarea
            id="anmerkungen"
            rows={3}
            className={`w-full rounded-md border px-3 py-2 text-xs ${YELLOW}`}
            value={answers[notes.key]?.answer ?? ""}
            onChange={(e) => setAnswer(notes.key, { answer: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
