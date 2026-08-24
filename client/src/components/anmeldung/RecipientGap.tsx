/**
 * The one place a missing recipient can be fixed instead of only reported.
 *
 * ---------------------------------------------------------------------------
 * Why this exists at all
 * ---------------------------------------------------------------------------
 * LST has 52 Prüfungen, 22 of them open, and both of its recipient rows in the
 * Hilfsdatei are empty. The Excel macro sent to an empty string and reported a
 * successful send. This app has known about it since the workbook was
 * transcribed — `departmentsWithoutRecipients()` has returned ["LST"] the whole
 * time — and used that knowledge in one script and one test and nowhere a
 * reader could see it.
 *
 * Detecting a gap and never showing it to somebody who could close it is
 * barely better than not detecting it. So this says plainly that nobody will
 * be reached, and offers the only thing that can actually change that: a field
 * for the person who knows the address.
 *
 * The address is never derived. `vorname.nachname@deutschebahn.com` is right
 * often enough to be dangerous, and a notification that reaches the wrong real
 * person is worse than one that reaches nobody. It comes from a human, and the
 * entry records which human and when.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Check, Plus, X } from "lucide-react";
import { useRecipientOverrides } from "@/hooks/useRecipientOverrides";
import { useAuditTrail } from "@/hooks/useAuditTrail";
import { OVERRIDE_PROBLEM_TEXT, type OverrideProblem } from "@shared/contact-overrides";

export function RecipientGap({
  departments,
  onChanged,
}: {
  /** Departments that would notify nobody, after the workbook and any supplied. */
  departments: readonly string[];
  onChanged?: () => void;
}) {
  const { overrides, add, remove } = useRecipientOverrides();
  const { recordDocument } = useAuditTrail();
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [mail, setMail] = useState("");
  const [problem, setProblem] = useState<OverrideProblem | null>(null);

  /*
   * Everything recorded, not just the department whose form happens to be open.
   *
   * It was filtered on `open`, which is set to null the instant an address is
   * saved — so the entry vanished at exactly the moment somebody wanted to see
   * that it had worked. Submitting into a form that then shows nothing is
   * indistinguishable from submitting into a form that failed.
   */
  const supplied = overrides;

  if (departments.length === 0 && overrides.length === 0) return null;

  const submit = (department: string) => {
    const failure = add({ department, name, mail }, "Angemeldeter Benutzer");
    setProblem(failure);
    if (failure) return;
    /* Recorded like every other change on this site: an address that routes a
       Fachprüfung is not a preference, it is data. */
    recordDocument(
      `Empfänger für ${department} ergänzt`,
      `${name.trim()} <${mail.trim().toLowerCase()}> — in der Hilfsdatei ist für ${department} keine Adresse hinterlegt.`,
    );
    setName("");
    setMail("");
    setOpen(null);
    onChanged?.();
  };

  return (
    <div
      data-recipient-gap={departments.join(",")}
      className="mt-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2.5"
    >
      {departments.length > 0 && (
        <p className="flex items-start gap-1.5 text-2xs font-bold text-primary-strong">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Für {departments.join(", ")} ist in der Hilfsdatei keine E-Mail-Adresse hinterlegt.
            Die Prüfung wird angelegt, aber es kann niemand benachrichtigt werden.
          </span>
        </p>
      )}

      {departments.map((department) => (
        <div key={department} className="mt-2">
          {open === department ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit(department);
              }}
              className="space-y-2"
            >
              <div className="flex flex-wrap gap-2">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Name der Person"
                  aria-label={`Name des Empfängers für ${department}`}
                  data-gap-name={department}
                  className="h-9 min-w-[10rem] flex-1 text-xs"
                />
                <Input
                  value={mail}
                  onChange={(e) => setMail(e.target.value)}
                  placeholder="E-Mail-Adresse"
                  type="email"
                  aria-label={`E-Mail-Adresse des Empfängers für ${department}`}
                  data-gap-mail={department}
                  className="h-9 min-w-[12rem] flex-1 text-xs"
                />
                <Button type="submit" size="sm" className="h-9 gap-1.5 text-2xs">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Eintragen
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setOpen(null);
                    setProblem(null);
                  }}
                  className="h-9 gap-1 text-2xs"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  Abbrechen
                </Button>
              </div>
              {problem && (
                <p data-gap-problem={problem} className="text-2xs font-bold text-primary-strong">
                  {OVERRIDE_PROBLEM_TEXT[problem]}
                </p>
              )}
              <p className="text-2xs text-muted-foreground">
                Die Adresse wird hier ergänzt, nicht erzeugt — sie stammt von Ihnen, und der
                Eintrag hält fest, wer sie wann hinterlegt hat. Die Hilfsdatei bleibt
                unverändert.
              </p>
            </form>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-gap-open={department}
              onClick={() => {
                setOpen(department);
                setProblem(null);
              }}
              className="h-8 gap-1.5 text-2xs"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Empfänger für {department} eintragen
            </Button>
          )}
        </div>
      ))}

      {supplied.length > 0 && (
        <ul className="mt-2 space-y-1">
          {supplied.map((o) => (
            <li key={o.mail} className="flex items-center gap-2 text-2xs">
              <span className="font-semibold">{o.name}</span>
              <span className="text-muted-foreground">{o.mail}</span>
              <span className="text-muted-foreground">
                — ergänzt von {o.addedBy} am {new Date(o.addedAt).toLocaleDateString("de-DE")}
              </span>
              <button
                type="button"
                onClick={() => remove(o.department, o.mail)}
                className="rounded px-1 underline decoration-dotted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                entfernen
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default RecipientGap;
