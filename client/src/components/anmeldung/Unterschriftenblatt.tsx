import type { GeneratedReview } from "@shared/checklist";
import {
  DEPARTMENTS_WITHOUT_SIGNATURE_BLOCK,
  UNTERSCHRIFTENBLATT,
  UNTERSCHRIFTENBLATT_ISSUER,
  UNTERSCHRIFTENBLATT_TITLE,
} from "@shared/checklist";

interface Props {
  projektnummer: string;
  projektbezeichnung: string;
  projektleitung: string;
  reviews: GeneratedReview[];
  /** rendered inside the wizard (screen) or standalone for printing */
  variant?: "preview" | "print";
}

/**
 * Live preview of sheet `Checkliste` — the Unterschriftenblatt.
 *
 * The "Prüfung erforderlich / nicht erforderlich" column is driven by the
 * checklist answers rather than being ticked by hand, so it cannot disagree with
 * the reviews the same answers generated.
 *
 * PDF export arrives in Stage 4. This is print-ready HTML: the `print:` classes
 * make Ctrl-P produce the sheet on its own, without the app chrome.
 */
export function Unterschriftenblatt({
  projektnummer,
  projektbezeichnung,
  projektleitung,
  reviews,
  variant = "preview",
}: Props) {
  const byDepartment = new Map(reviews.map((r) => [r.department, r]));

  return (
    <div
      className={
        variant === "print"
          ? "bg-white text-black p-8"
          : "bg-card border-2 border-border rounded-xl p-6 text-[11px] print:border-0 print:p-0"
      }
    >
      <div className="flex items-baseline justify-between border-b-2 border-[#FF0000] pb-2">
        <span className="font-black tracking-tight">{UNTERSCHRIFTENBLATT_ISSUER}</span>
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground print:text-black">
          Vorschau
        </span>
      </div>
      <h3 className="mt-3 text-sm font-black leading-tight">{UNTERSCHRIFTENBLATT_TITLE}</h3>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="font-bold">Projektnummer:</dt>
        <dd>{projektnummer || <span className="text-muted-foreground">—</span>}</dd>
        <dt className="font-bold">Projektbezeichnung:</dt>
        <dd>{projektbezeichnung || <span className="text-muted-foreground">—</span>}</dd>
        <dt className="font-bold">Name Projektleitung:</dt>
        <dd>{projektleitung || <span className="text-muted-foreground">—</span>}</dd>
      </dl>

      <table className="mt-4 w-full border-collapse">
        <caption className="sr-only">
          Unterschriftenblatt — Prüfung, Zustimmung und Unterschrift je Fachbereich
        </caption>
        <thead>
          <tr className="border-y border-border text-[9px] uppercase tracking-wider">
            <th scope="col" className="py-1 text-left font-black">
              Name / Funktion
            </th>
            <th scope="col" className="py-1 text-center font-black">
              Prüfung
            </th>
            <th scope="col" className="py-1 text-center font-black">
              Zustimmung
            </th>
            <th scope="col" className="py-1 text-right font-black">
              Datum / Unterschrift
            </th>
          </tr>
        </thead>
        <tbody>
          {UNTERSCHRIFTENBLATT.map((block) => {
            const review = block.department ? byDepartment.get(block.department) : undefined;
            const required = review?.status === "offen";
            return (
              <tr key={`${block.ou}-${block.role}`} className="border-b border-border/60">
                <td className="py-1.5 align-top">
                  <div className="font-bold">{block.role}</div>
                  <div className="text-[9px] text-muted-foreground print:text-black">
                    {block.ou}
                    {block.name ? ` · ${block.name}` : ""}
                  </div>
                </td>
                <td className="py-1.5 text-center align-top">
                  {block.acknowledgeOnly ? (
                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground print:text-black">
                      zur Kenntnis
                    </span>
                  ) : block.department ? (
                    <span
                      className={
                        required
                          ? "rounded bg-[#FF0000]/10 px-2 py-0.5 font-black text-[#FF0000]"
                          : "text-muted-foreground print:text-black"
                      }
                    >
                      {required ? "erforderlich" : "nicht erforderlich"}
                    </span>
                  ) : (
                    <span className="text-muted-foreground print:text-black">—</span>
                  )}
                </td>
                <td className="py-1.5 text-center align-top text-muted-foreground print:text-black">
                  ja ☐ nein ☐
                </td>
                <td className="py-1.5 text-right align-top text-muted-foreground print:text-black">
                  ______________
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="mt-3 text-[9px] leading-relaxed text-muted-foreground print:text-black">
        Hinweis: {DEPARTMENTS_WITHOUT_SIGNATURE_BLOCK.join(" und ")} haben auf dem
        Unterschriftenblatt der Vorlage keinen eigenen Block. Ihre Prüfungen werden in der
        Projektübersicht geführt.
      </p>
    </div>
  );
}
