/**
 * The project detail dialog.
 *
 * What was here before: a "Details anzeigen" button whose entire handler was
 * `setViewMode("table")`. It showed no details, and the map's project click
 * did the same thing plus a toast that claimed the project was "in der Tabelle
 * angezeigt" while nothing was selected, filtered or scrolled to.
 *
 * ---------------------------------------------------------------------------
 * Contact data — what is real and what is absent
 * ---------------------------------------------------------------------------
 * Every address shown here comes from `Hilfsdatei` via shared/contacts.ts.
 * Nothing is constructed. The three channels differ in reach, and the dialog
 * says which is which instead of showing a uniform row of buttons that half
 * work:
 *
 *   Bahnhofsmanagement  8 of 8 regions have an address — always contactable
 *   Fachprüfer          29 of 44 names resolve (6,855 of 10,489 review rows)
 *   Projektleiter       3 of 252 names resolve (8 of 1,260 projects)
 *
 * Where a name does not resolve, the dialog states why and offers the
 * department's own recipients instead, which is the route the Anmeldung macro
 * already uses. It never falls back to a guessed address.
 *
 * Telephone: there is no telephone number in any source — `Hilfsdatei` holds
 * row, group, name and mail, and data.json holds no contact column at all. The
 * dialog says so once, in the contact section, rather than rendering a dead
 * button.
 *
 * Microsoft Teams: `https://teams.microsoft.com/l/chat/0/0?users=<mail>` is
 * derived from the address already on file, so it opens a chat with the same
 * person the mail button writes to.
 */
import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Mail,
  MessageSquare,
  ExternalLink,
  Phone,
  MapPin,
  User,
  CalendarClock,
  Hash,
  Info,
  ArrowRight,
} from "lucide-react";
import type { Project } from "@/hooks/useDataQuery";
import { useAuditLog } from "@/hooks/useDataQuery";
import { DEPARTMENTS, type Department } from "@shared/types";
import { statusBadgeClass } from "@shared/status-appearance";
import { normalizeReviewStatus, isOpen, isBlocking } from "@shared/review-status";
import { formatGerman } from "@shared/date";
import { projectLinkUrl } from "@shared/project-link";
import { bahnhofsmanagementContact, recipientsFor, type Contact } from "@shared/contacts";
import {
  resolveContact,
  contactOf,
  resolutionNote,
  displayNameOf,
  mailtoHref,
  teamsChatHref,
} from "@shared/contact-resolution";

interface ProjectDetailDialogProps {
  project: Project | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Jump to every other project at this station. Hidden when not provided. */
  onShowStation?: (station: string) => void;
}

/** Subject line built from real fields only. */
function subjectFor(project: Project, department?: string): string {
  const nr = project.projektnummer?.trim();
  const station = project.station?.trim();
  const head = nr ? `Projekt ${nr}` : "Projekt";
  const parts = [head, station, department].filter(Boolean);
  return parts.join(" – ");
}

function ContactActions({
  contact,
  subject,
  size = "sm",
}: {
  contact: Contact;
  subject: string;
  size?: "sm" | "xs";
}) {
  const h = size === "xs" ? "h-8" : "h-9";
  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline" size="sm" className={`${h} gap-1.5`}>
        <a href={mailtoHref(contact, subject)} aria-label={`E-Mail an ${contact.name || contact.mail}`}>
          <Mail className="h-3.5 w-3.5" aria-hidden="true" />
          E-Mail
        </a>
      </Button>
      <Button asChild variant="outline" size="sm" className={`${h} gap-1.5`}>
        <a
          href={teamsChatHref(contact)}
          target="_blank"
          rel="noreferrer"
          aria-label={`Microsoft-Teams-Chat mit ${contact.name || contact.mail}`}
        >
          <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
          Teams
        </a>
      </Button>
    </div>
  );
}

/** One named person, with whatever contact route actually exists for them. */
function ContactRow({
  /** Named `roleLabel`, not `role`: on a component `role` reads as the ARIA
   *  attribute, and the linter flags "Projektleiter" as an invalid one. */
  roleLabel,
  name,
  subject,
  fallback,
  fallbackLabel,
}: {
  roleLabel: string;
  name: string | null | undefined;
  subject: string;
  /** Who to write to when the person has no address of their own. */
  fallback?: Contact[] | null;
  fallbackLabel?: string;
}) {
  const resolution = resolveContact(name);
  const contact = contactOf(resolution);
  const note = resolutionNote(resolution);

  return (
    /* Identity above, actions below. Side by side, a two-line role label plus a
       full name lost a measured half of its width to the buttons and truncated
       to "BAHNHOFSMANAG..." / "Kathrin Behs...". */
    <div className="flex flex-col gap-2 rounded-xl border border-border/60 p-3">
      <div className="min-w-0">
        <p className="text-2xs font-bold uppercase leading-tight tracking-widest text-muted-foreground">
          {roleLabel}
        </p>
        <p className="break-words text-sm font-bold">{displayNameOf(resolution, name)}</p>
        {contact && <p className="break-all text-2xs text-muted-foreground">{contact.mail}</p>}
      </div>
      {contact && <ContactActions contact={contact} subject={subject} size="xs" />}

      {!contact && (
        <p className="text-2xs leading-relaxed text-amber-700 dark:text-amber-500">
          {note}
          {fallback && fallback.length > 0 && ` — ${fallbackLabel ?? "Ersatzweise erreichbar über"}:`}
        </p>
      )}

      {!contact && fallback && fallback.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {fallback.map((c) => (
            <Button key={c.row} asChild variant="outline" size="sm" className="h-8 gap-1.5">
              <a href={mailtoHref(c, subject)} aria-label={`E-Mail an ${c.name || c.mail}`}>
                <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                {c.name || c.mail}
              </a>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | null | undefined;
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}) {
  const v = String(value ?? "").trim();
  return (
    /*
      A fixed two-line label box, not a min-height.
    
      `min-h` only guarantees a floor: at 375px "Termin Projektvorstellung"
      wrapped to three lines, grew past the 1.75rem, and painted over
      "Projektstand" in the next column — a measured 168px² collision. A fixed
      height with a two-line clamp cannot grow into its neighbour, and it keeps
      every value on the same baseline across the row, which is what the
      min-height was there for in the first place. The full text stays
      available through `title`.
    */
    <div className="min-w-0">
      <p
        title={label}
        className="flex h-8 items-start gap-1.5 text-2xs font-bold uppercase leading-tight tracking-widest text-muted-foreground"
      >
        {Icon && <Icon className="mt-px h-3 w-3 shrink-0" aria-hidden={true} />}
        <span className="line-clamp-2">{label}</span>
      </p>
      <p className={`mt-0.5 break-words text-sm ${v ? "font-semibold" : "text-muted-foreground"}`}>
        {v || "—"}
      </p>
    </div>
  );
}

export function ProjectDetailDialog({
  project,
  open,
  onOpenChange,
  onShowStation,
}: ProjectDetailDialogProps) {
  const { data: auditEntries } = useAuditLog();

  // Every department, not only the ones with a row: a Fachprüfung that is
  // absent from the data is information too ("nicht erforderlich" vs "offen"
  // vs never recorded), and the checklist always produces all 14.
  const reviewByDept = useMemo(() => {
    const m = new Map<string, Project["reviews"][number]>();
    for (const r of project?.reviews ?? []) if (r.department) m.set(r.department, r);
    return m;
  }, [project]);

  const openCount = useMemo(
    () => (project?.reviews ?? []).filter((r) => isOpen(r.status)).length,
    [project],
  );
  const blockedCount = useMemo(
    () => (project?.reviews ?? []).filter((r) => isBlocking(r.status)).length,
    [project],
  );

  /** Audit entries that name this project. The trail stores free text, so the
   *  match is on the Projektnummer when there is one and on the id otherwise. */
  const history = useMemo(() => {
    if (!project || !auditEntries) return [];
    const needles = [project.projektnummer?.trim(), `#${project.id}`].filter(Boolean) as string[];
    if (needles.length === 0) return [];
    return auditEntries
      .filter((e) => needles.some((n) => e.details?.includes(n)))
      .slice(0, 8);
  }, [project, auditEntries]);

  if (!project) return null;

  const url = projectLinkUrl(project.projektLink);
  const linkNote = !url && project.projektLink?.trim() ? project.projektLink.trim() : null;
  const bmContact = bahnhofsmanagementContact(project.bahnhofsmanagement);
  const subject = subjectFor(project);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        Full height minus the gutter on a phone, capped on a desktop. The body
        scrolls, not the page behind it, and the header stays put — a 14-row
        Fachprüfungen table plus the contact block is well past one screen on
        a 667px phone.
      */}
      {/* `sm:max-w-3xl`, not `max-w-3xl`: DialogContent's own class list ends with
          `sm:max-w-lg`, so an unprefixed override loses at every width the
          dialog is actually wide at. Measured 512px before this. */}
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:w-full sm:max-w-3xl">
        {/* pr-14: the primitive parks its close button at top-4 right-4, and on a
            375px phone the badge row wrapped straight under it — "6 offen" and
            the X occupied the same 40px. */}
        <DialogHeader className="space-y-3 border-b bg-muted/30 p-5 pr-14 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-primary/10 px-2 py-0.5 font-mono text-xs font-bold text-primary-strong">
              {project.projektnummer || "ohne Projektnummer"}
            </span>
            {project.projektstand && (
              <Badge variant="outline" className="text-2xs font-bold">
                {project.projektstand}
              </Badge>
            )}
            {openCount > 0 && (
              <Badge className={`${statusBadgeClass("offen")} text-2xs font-bold`}>
                {openCount} offen
              </Badge>
            )}
            {blockedCount > 0 && (
              <Badge className={`${statusBadgeClass("abgelehnt")} text-2xs font-bold`}>
                {blockedCount} blockiert
              </Badge>
            )}
          </div>

          <DialogTitle className="text-xl font-bold leading-tight tracking-tight sm:text-2xl">
            {project.station || "Ohne Station"}
          </DialogTitle>

          <DialogDescription className="text-sm leading-relaxed">
            {project.projektbeschreibung?.trim() || "Keine Projektbeschreibung hinterlegt."}
          </DialogDescription>

          <div className="flex flex-wrap gap-2 pt-1">
            {url && (
              <Button asChild size="sm" className="h-9 gap-1.5">
                <a href={url} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  Projekt öffnen
                </a>
              </Button>
            )}
            {onShowStation && project.station && (
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5"
                onClick={() => {
                  onShowStation(project.station as string);
                  onOpenChange(false);
                }}
              >
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                Alle Projekte dieser Station
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            )}
            {bmContact && (
              <Button asChild variant="outline" size="sm" className="h-9 gap-1.5">
                <a href={mailtoHref(bmContact, subject)}>
                  <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                  Bahnhofsmanagement
                </a>
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <section aria-labelledby="pd-stamm">
            <h3 id="pd-stamm" className="mb-3 text-2xs font-bold uppercase tracking-widest text-muted-foreground">
              Stammdaten
            </h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <Field label="Region / BM" value={project.bahnhofsmanagement} icon={MapPin} />
              <Field label="Bahnhofsnummer" value={project.bahnhofsnummer} icon={Hash} />
              <Field label="Streckennummer" value={project.streckennummer} icon={Hash} />
              <Field label="Projektleiter" value={project.projektleiter} icon={User} />
              <Field
                label="Termin Projektvorstellung"
                value={formatGerman(project.terminProjektvorstellung)}
                icon={CalendarClock}
              />
              <Field label="Projektstand" value={project.projektstand} />
            </div>

            {linkNote && (
              <p className="mt-4 rounded-lg border border-border/60 bg-muted/40 p-3 text-2xs leading-relaxed text-muted-foreground">
                <span className="font-bold uppercase tracking-widest">Projektlink-Feld</span>
                <br />
                {linkNote}
                <br />
                <span className="italic">
                  Kein Link — dieses Feld enthält hier eine Notiz, keine Adresse.
                </span>
              </p>
            )}

            {project.kommentar?.trim() && (
              <div className="mt-4">
                <p className="text-2xs font-bold uppercase tracking-widest text-muted-foreground">
                  Kommentar
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {project.kommentar.trim()}
                </p>
              </div>
            )}
          </section>

          <Separator className="my-5" />

          <section aria-labelledby="pd-kontakt">
            <h3 id="pd-kontakt" className="mb-3 text-2xs font-bold uppercase tracking-widest text-muted-foreground">
              Kontakt
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <ContactRow
                roleLabel="Projektleiter"
                name={project.projektleiter}
                subject={subject}
                fallback={bmContact ? [bmContact] : null}
                fallbackLabel="Zuständiges Bahnhofsmanagement"
              />
              {bmContact ? (
                <div className="flex flex-col gap-2 rounded-xl border border-border/60 p-3">
                  <div className="min-w-0">
                    <p className="text-2xs font-bold uppercase leading-tight tracking-widest text-muted-foreground">
                      Bahnhofsmanagement {project.bahnhofsmanagement}
                    </p>
                    <p className="break-words text-sm font-bold">{bmContact.name}</p>
                    <p className="break-all text-2xs text-muted-foreground">{bmContact.mail}</p>
                  </div>
                  <ContactActions contact={bmContact} subject={subject} size="xs" />
                </div>
              ) : (
                <div className="rounded-xl border border-border/60 p-3">
                  <p className="text-2xs font-bold uppercase tracking-widest text-muted-foreground">
                    Bahnhofsmanagement
                  </p>
                  <p className="mt-1 text-2xs text-amber-700 dark:text-amber-500">
                    Für „{project.bahnhofsmanagement || "—"}“ ist in der Hilfsdatei kein
                    Bahnhofsmanagement hinterlegt.
                  </p>
                </div>
              )}
            </div>

            <p className="mt-3 flex items-start gap-2 text-2xs leading-relaxed text-muted-foreground">
              <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                Telefonnummern sind in keiner Quelle hinterlegt — die Hilfsdatei führt Zeile,
                Gruppe, Name und E-Mail. Sobald dort eine Telefonspalte existiert, erscheint sie
                hier automatisch.
              </span>
            </p>
          </section>

          <Separator className="my-5" />

          <section aria-labelledby="pd-pruefungen">
            <h3 id="pd-pruefungen" className="mb-3 text-2xs font-bold uppercase tracking-widest text-muted-foreground">
              Fachprüfungen ({reviewByDept.size} von {DEPARTMENTS.length} erfasst)
            </h3>

            <div className="overflow-x-auto rounded-xl border border-border/60">
              <table className="stack-table w-full border-collapse text-xs">
                <caption className="sr-only">
                  Fachprüfungen des Projekts mit Status, Prüfer, Prüfdatum und Kontaktweg
                </caption>
                <thead className="bg-muted/50">
                  <tr>
                    <th scope="col" className="whitespace-nowrap px-3 py-2 text-left font-semibold text-muted-foreground">
                      Gewerk
                    </th>
                    <th scope="col" className="whitespace-nowrap px-3 py-2 text-left font-semibold text-muted-foreground">
                      Status
                    </th>
                    <th scope="col" className="whitespace-nowrap px-3 py-2 text-left font-semibold text-muted-foreground">
                      Prüfer
                    </th>
                    <th scope="col" className="whitespace-nowrap px-3 py-2 text-left font-semibold text-muted-foreground">
                      Prüfdatum
                    </th>
                    <th scope="col" className="whitespace-nowrap px-3 py-2 text-left font-semibold text-muted-foreground">
                      Kontakt
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {DEPARTMENTS.map((dept) => {
                    const review = reviewByDept.get(dept);
                    const status = normalizeReviewStatus(review?.status);
                    const resolution = resolveContact(review?.prueferName);
                    const prueferContact = contactOf(resolution);
                    // The department's own recipients are the route the
                    // Anmeldung macro uses; LST has none on file at all.
                    const deptRecipients = recipientsFor(dept as Department);
                    const deptSubject = subjectFor(project, dept);

                    return (
                      <tr key={dept} className="border-t border-border/60 align-top">
                        <td data-label="Gewerk" className="px-3 py-2">
                          <span className="font-bold">{dept}</span>
                          {/* The Hilfsdatei group label, but only when it says
                              more than the code already does: "Baubetriebs-
                              technologie" over "Baubetriebstechnologe" is noise,
                              "Fördertechnik" over "HFT" is not. */}
                          {(() => {
                            const group = deptRecipients[0]?.group?.trim();
                            if (!group) return null;
                            const a = group.toLowerCase();
                            const b = dept.toLowerCase();
                            if (a === b || a.startsWith(b) || b.startsWith(a)) return null;
                            return (
                              <span className="block text-2xs text-muted-foreground">{group}</span>
                            );
                          })()}
                        </td>
                        <td data-label="Status" className="px-3 py-2">
                          {review ? (
                            <Badge className={`${statusBadgeClass(review.status)} text-2xs font-bold`}>
                              {status ?? review.status ?? "—"}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">nicht erfasst</span>
                          )}
                        </td>
                        <td data-label="Prüfer" className="px-3 py-2">
                          <span className={prueferContact ? "font-semibold" : "text-muted-foreground"}>
                            {resolution.kind === "empty"
                              ? "—"
                              : displayNameOf(resolution, review?.prueferName)}
                          </span>
                          {/* Only when the note adds something the name does not
                              already say. A placeholder's label IS the note, and
                              printing both rendered "Noch niemand zugeordnet"
                              twice in the same cell. */}
                          {resolution.kind === "unknown" || resolution.kind === "ambiguous" ? (
                            <span className="block text-2xs text-amber-700 dark:text-amber-500">
                              {resolutionNote(resolution)}
                            </span>
                          ) : null}
                        </td>
                        <td data-label="Prüfdatum" className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                          {formatGerman(review?.pruefDatum) || "—"}
                        </td>
                        <td data-label="Kontakt" className="px-3 py-2">
                          {prueferContact ? (
                            <div className="flex gap-1">
                              <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                                <a
                                  href={mailtoHref(prueferContact, deptSubject)}
                                  title={`E-Mail an ${prueferContact.name}`}
                                  aria-label={`E-Mail an ${prueferContact.name} (${dept})`}
                                >
                                  <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                                </a>
                              </Button>
                              <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                                <a
                                  href={teamsChatHref(prueferContact)}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={`Teams-Chat mit ${prueferContact.name}`}
                                  aria-label={`Teams-Chat mit ${prueferContact.name} (${dept})`}
                                >
                                  <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                                </a>
                              </Button>
                            </div>
                          ) : deptRecipients.length > 0 ? (
                            <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 px-2">
                              <a
                                href={mailtoHref(deptRecipients[0] as Contact, deptSubject)}
                                title={`An den Fachbereich ${dept} schreiben`}
                                aria-label={`An den Fachbereich ${dept} schreiben`}
                              >
                                <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                                Fachbereich
                              </a>
                            </Button>
                          ) : (
                            <span
                              className="text-2xs text-amber-700 dark:text-amber-500"
                              title={`Für ${dept} ist in der Hilfsdatei keine Adresse hinterlegt`}
                            >
                              keine Adresse
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {history.length > 0 && (
            <>
              <Separator className="my-5" />
              <section aria-labelledby="pd-verlauf">
                <h3 id="pd-verlauf" className="mb-3 text-2xs font-bold uppercase tracking-widest text-muted-foreground">
                  Änderungen an diesem Projekt
                </h3>
                <ul className="space-y-2">
                  {history.map((e) => (
                    <li key={e.id} className="flex gap-3 text-2xs">
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {new Date(e.timestamp).toLocaleString("de-DE")}
                      </span>
                      <span className="min-w-0 break-words">
                        <span className="font-bold">{e.user}</span> — {e.details}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}

          <p className="mt-5 flex items-start gap-2 text-2xs leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              Alle Angaben stammen aus derselben Quelle wie Tabelle, Karte und Dashboard.
              Änderungen an einer Stelle sind hier sofort sichtbar.
            </span>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ProjectDetailDialog;
