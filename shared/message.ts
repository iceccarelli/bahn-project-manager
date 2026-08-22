/**
 * The text every outgoing mail and Teams message starts with.
 *
 * Before this, a mail button produced a subject and an empty body: the
 * recipient got "Projekt G.011540063 – Langenselbold" and a blank page, and the
 * sender had to retype the context they were just looking at. Worse, nothing in
 * the message said where it came from, so a reply landed in a thread with no
 * way back to the record.
 *
 * Both channels share one builder so a mail and a Teams chat about the same
 * Fachprüfung carry the same facts in the same order.
 *
 * Everything here is composed from fields the caller already holds. Nothing is
 * inferred, and a field that is empty is omitted rather than filled with a
 * placeholder — a prefilled mail that states something false is worse than a
 * short one.
 */

export interface MessageSubject {
  projektnummer?: string | null;
  station?: string | null;
  /** The Gewerk this message is about, when it is about one. */
  department?: string | null;
}

export interface MessageContext extends MessageSubject {
  bahnhofsmanagement?: string | null;
  projektstand?: string | null;
  projektbeschreibung?: string | null;
  terminProjektvorstellung?: string | null;
  /** Status of the Fachprüfung named by `department`, when there is one. */
  status?: string | null;
  prueferName?: string | null;
  pruefDatum?: string | null;
  /** Who is writing. */
  absender?: string | null;
  /** Deep link back to this project in the app. */
  href?: string | null;
  /** When the message was composed. */
  generatedAt?: string | null;
}

const clean = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();

/**
 * `Projekt G.011540063 – Langenselbold – ITK`
 *
 * Projektnummer first because that is what a recipient searches for, and it is
 * what makes the subject unique: 41 stations carry more than one project.
 */
export function messageSubject(m: MessageSubject): string {
  const nr = clean(m.projektnummer);
  const parts = [nr ? `Projekt ${nr}` : "Projekt", clean(m.station), clean(m.department)];
  return parts.filter(Boolean).join(" – ");
}

/**
 * The body, as plain text.
 *
 * Ordered the way the recipient reads it: what is being asked about, the facts
 * they need to answer without opening anything, then where it came from.
 * `\n` throughout — a mailto body is percent-encoded and CRLF would arrive as
 * literal characters in some clients.
 */
export function messageBody(m: MessageContext): string {
  const lines: string[] = [];

  const dept = clean(m.department);
  const nr = clean(m.projektnummer);
  const station = clean(m.station);

  lines.push("Guten Tag,");
  lines.push("");
  lines.push(
    dept
      ? `es geht um die ${dept}-Fachprüfung im folgenden Projekt:`
      : "es geht um das folgende Projekt:",
  );
  lines.push("");

  const field = (k: string, v: unknown) => {
    const value = clean(v);
    if (value) lines.push(`${k}: ${value}`);
  };

  field("Projektnummer", nr);
  field("Station", station);
  field("Bahnhofsmanagement", m.bahnhofsmanagement);
  field("Projektstand", m.projektstand);
  field("Beschreibung", m.projektbeschreibung);
  field("Termin Projektvorstellung", m.terminProjektvorstellung);

  if (dept) {
    lines.push("");
    field(`Status ${dept}`, m.status);
    field("Prüfer", m.prueferName);
    field("Prüfdatum", m.pruefDatum);
  }

  lines.push("");
  lines.push("Mit freundlichen Grüßen");
  const from = clean(m.absender);
  if (from) lines.push(from);

  // Provenance last, and visually separated: it is for the recipient's
  // orientation, not part of the message.
  const at = clean(m.generatedAt);
  const href = clean(m.href);
  if (at || href) {
    lines.push("");
    lines.push("--");
    lines.push(
      `Erstellt aus dem Bahn Project Manager${at ? ` am ${at}` : ""}.`,
    );
    if (href) lines.push(`Projekt öffnen: ${href}`);
  }

  return lines.join("\n");
}

/** A mailto: with both the subject and the body already written. */
export function mailtoWithContext(mail: string, m: MessageContext): string {
  const params = new URLSearchParams({
    subject: messageSubject(m),
    body: messageBody(m),
  });
  return `mailto:${mail}?${params.toString()}`;
}

/**
 * A Teams chat deep link with the message already typed.
 *
 * Teams puts `message` into the compose box rather than sending it, so the
 * sender still reviews and presses enter. The subject line is repeated as the
 * first line because a chat has no subject field and the recipient otherwise
 * sees the body's first sentence with no idea which project it names.
 */
export function teamsChatWithContext(mail: string, m: MessageContext): string {
  const params = new URLSearchParams({
    users: mail,
    message: `${messageSubject(m)}\n\n${messageBody(m)}`,
  });
  return `https://teams.microsoft.com/l/chat/0/0?${params.toString()}`;
}
