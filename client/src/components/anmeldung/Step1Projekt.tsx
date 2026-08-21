import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { stationKey, useStations } from "@/hooks/useStations";
import type { ChecklistDraft } from "@/hooks/useChecklistDraft";
import { PROJEKTSTAENDE } from "@shared/projektstand";
import type { Bahnhofsmanagement } from "@shared/bahnhofsmanagement";

/** The workbook's instruction: "Bitte nur die gelben Felder befüllen!" */
const YELLOW =
  "bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800/70 focus-visible:ring-amber-400";

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-bold tracking-tight">
        {label}
      </label>
      {children}
      {/* reserved line: keeps the row height constant so validation causes no layout shift */}
      <p
        className={`min-h-[16px] text-2xs leading-4 ${error ? "font-bold text-primary-strong" : "text-muted-foreground"}`}
        id={`${id}-hint`}
      >
        {error ?? hint ?? ""}
      </p>
    </div>
  );
}

export function Step1Projekt({ draft }: { draft: ChecklistDraft }) {
  const { header, setField, stepIssues } = draft;
  const { regions, stationsByRegion, bfNrByRegionStation, regionByStation } = useStations();
  const issue = (field: string) => stepIssues[1]?.find((i) => i.field === field)?.message;

  const stations = header.bahnhofsmanagement
    ? (stationsByRegion[header.bahnhofsmanagement] ?? [])
    : [];

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs dark:border-amber-800/70 dark:bg-amber-950/40">
        <strong className="font-black">Bitte nur die gelben Felder befüllen.</strong> Bahnhofsnummer
        und BM werden aus der Station abgeleitet.
      </div>

      <div className="grid gap-x-8 gap-y-1 md:grid-cols-2">
        <Field
          id="projektnummer"
          label="Projektnummer *"
          hint="z.B. G.011511006"
          error={issue("projektnummer")}
        >
          <Input
            id="projektnummer"
            aria-describedby="projektnummer-hint"
            aria-invalid={Boolean(issue("projektnummer"))}
            className={YELLOW}
            value={header.projektnummer}
            onChange={(e) => setField("projektnummer", e.target.value)}
          />
        </Field>

        <Field
          id="projektleitung"
          label="Name der Projektleitung *"
          error={issue("projektleitung")}
        >
          <Input
            id="projektleitung"
            aria-describedby="projektleitung-hint"
            aria-invalid={Boolean(issue("projektleitung"))}
            className={YELLOW}
            value={header.projektleitung}
            onChange={(e) => setField("projektleitung", e.target.value)}
          />
        </Field>

        <Field
          id="projektbezeichnung"
          label="Projektbezeichnung *"
          hint='Kein "/" verwenden, möglichst kurz halten'
          error={issue("projektbezeichnung")}
        >
          <Input
            id="projektbezeichnung"
            aria-describedby="projektbezeichnung-hint"
            aria-invalid={Boolean(issue("projektbezeichnung"))}
            className={YELLOW}
            value={header.projektbezeichnung}
            onChange={(e) => setField("projektbezeichnung", e.target.value)}
          />
        </Field>

        <Field id="streckennummer" label="Streckennummer">
          <Input
            id="streckennummer"
            className={YELLOW}
            value={header.streckennummer}
            onChange={(e) => setField("streckennummer", e.target.value)}
          />
        </Field>

        <Field
          id="bahnhofsmanagement"
          label="Bahnhofsmanagement (BM) *"
          hint="Bestimmt die Auswahl der Stationen"
          error={issue("bahnhofsmanagement")}
        >
          <Select
            value={header.bahnhofsmanagement || undefined}
            onValueChange={(v) => {
              setField("bahnhofsmanagement", v as Bahnhofsmanagement);
              setField("stationsname", "");
              setField("bahnhofsnummer", "");
            }}
          >
            <SelectTrigger
              id="bahnhofsmanagement"
              aria-describedby="bahnhofsmanagement-hint"
              className={YELLOW}
            >
              <SelectValue placeholder="BM wählen" />
            </SelectTrigger>
            <SelectContent>
              {regions.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          id="projektstand"
          label="Projektstand *"
          hint="Vorgaben aus Hilfsdatei N3:N12"
          error={issue("projektstand")}
        >
          <Select
            value={header.projektstand || undefined}
            onValueChange={(v) => setField("projektstand", v)}
          >
            <SelectTrigger id="projektstand" aria-describedby="projektstand-hint" className={YELLOW}>
              <SelectValue placeholder="Projektstand wählen" />
            </SelectTrigger>
            <SelectContent>
              {PROJEKTSTAENDE.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          id="stationsname"
          label="Stationsname *"
          hint={header.bahnhofsmanagement ? `${stations.length} Stationen im BM` : "Zuerst BM wählen"}
          error={issue("stationsname")}
        >
          <Select
            value={header.stationsname || undefined}
            disabled={!header.bahnhofsmanagement}
            onValueChange={(v) => {
              setField("stationsname", v);
              const nr = bfNrByRegionStation[stationKey(header.bahnhofsmanagement, v)];
              setField("bahnhofsnummer", nr != null ? String(nr) : "");
              // A station name that is unique network-wide back-fills the BM —
              // ambiguous ones are omitted from the index rather than guessed.
              const bm = regionByStation[v];
              if (bm && bm !== header.bahnhofsmanagement) setField("bahnhofsmanagement", bm);
            }}
          >
            <SelectTrigger id="stationsname" aria-describedby="stationsname-hint" className={YELLOW}>
              <SelectValue
                placeholder={header.bahnhofsmanagement ? "Station wählen" : "Zuerst BM wählen"}
              />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {stations.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field id="bahnhofsnummer" label="Bahnhofsnummer" hint="Automatisch aus der Station">
          <Input
            id="bahnhofsnummer"
            value={header.bahnhofsnummer}
            readOnly
           
            aria-readonly="true"
            aria-describedby="bahnhofsnummer-hint"
            className="cursor-not-allowed bg-muted text-muted-foreground"
            placeholder="– automatisch –"
          />
        </Field>
      </div>
    </div>
  );
}
