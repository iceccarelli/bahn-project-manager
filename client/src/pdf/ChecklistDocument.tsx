import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import interBold from "./Inter-Bold.ttf?url";
import interRegular from "./Inter-Regular.ttf?url";
import type { ChecklistAnswer, ChecklistQuestion, GeneratedReview } from "@shared/checklist";
import {
  CHECKLIST_QUESTIONS,
  DEPARTMENTS_WITHOUT_SIGNATURE_BLOCK,
  UNTERSCHRIFTENBLATT,
  UNTERSCHRIFTENBLATT_ISSUER,
  UNTERSCHRIFTENBLATT_TITLE,
} from "@shared/checklist";
import { DB_RED } from "@shared/brand";
import { displayName, recipientsFor } from "@shared/contacts";

/**
 * The Checkliste as a real PDF.
 *
 * Why @react-pdf/renderer and not something else
 * ----------------------------------------------
 * Production is a static SPA — vercel.json declares rewrites and no functions —
 * so there is no server to render a PDF on. That rules out the highest-fidelity
 * option (headless Chromium) outright; it would simply not exist in the
 * deployed environment. Of the client-side options, this one has a real layout
 * engine with pagination, which a 22-row question table plus a 19-block
 * signature sheet needs, and it emits a Blob so the user gets a download rather
 * than a print dialog. jsPDF would mean hand-positioning every cell.
 *
 * Fonts: Inter, embedded, in the same face the app uses on screen. The first
 * cut used the standard-14 Helvetica, which renders German correctly but has
 * no ToUnicode map — `pdffonts` reported `uni no`, and the text could not be
 * searched, copied or read by a screen reader. For a document that goes into a
 * project file that is a real defect, so the two weights the document uses are
 * instanced out of the variable Inter we already ship (scripts/make-pdf-fonts.py)
 * and embedded as static TTFs, ~89 kB each.
 *
 * An incomplete checklist still exports, watermarked ENTWURF. A tool that
 * refuses to give you the document until every field is perfect is a tool
 * people work around by taking screenshots.
 */

Font.register({
  family: "Inter",
  fonts: [
    { src: interRegular, fontWeight: 400 },
    { src: interBold, fontWeight: 700 },
  ],
});

// Inter has no italic in this build; without this @react-pdf tries to synthesise
// one and throws when it cannot find the face.
Font.registerHyphenationCallback((word) => [word]);

const s = StyleSheet.create({
  page: { paddingTop: 34, paddingBottom: 48, paddingHorizontal: 34, fontSize: 8, fontFamily: "Inter", color: "#111827" },
  bar: { flexDirection: "row", alignItems: "center", borderBottomWidth: 2, borderBottomColor: DB_RED, paddingBottom: 6, marginBottom: 10 },
  mark: { backgroundColor: DB_RED, color: "#FFFFFF", fontFamily: "Inter", fontWeight: 700, fontSize: 11, paddingHorizontal: 5, paddingVertical: 2.5, marginRight: 7 },
  issuer: { fontFamily: "Inter", fontWeight: 700, fontSize: 9 },
  issuerSub: { color: "#6B7280", fontSize: 7, marginTop: 1 },
  title: { fontFamily: "Inter", fontWeight: 700, fontSize: 13, marginBottom: 2 },
  subtitle: { color: "#6B7280", fontSize: 8, marginBottom: 10 },
  h2: { fontFamily: "Inter", fontWeight: 700, fontSize: 9.5, marginTop: 12, marginBottom: 5 },
  metaGrid: { flexDirection: "row", flexWrap: "wrap", borderTopWidth: 0.5, borderTopColor: "#D1D5DB" },
  metaCell: { width: "50%", flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#E5E7EB", paddingVertical: 3 },
  metaKey: { width: 92, color: "#6B7280", fontSize: 7.5 },
  metaVal: { flex: 1, fontFamily: "Inter", fontWeight: 700, fontSize: 7.5 },
  tHead: { flexDirection: "row", backgroundColor: "#F3F4F6", borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: "#D1D5DB", paddingVertical: 3.5 },
  th: { fontFamily: "Inter", fontWeight: 700, fontSize: 6.8, color: "#374151", paddingHorizontal: 3 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#E5E7EB", paddingVertical: 3.5 },
  td: { fontSize: 7, paddingHorizontal: 3 },
  cNr: { width: 20 }, cGewerk: { width: 108 }, cFrage: { flex: 1 }, cAntwort: { width: 74 }, cKommentar: { width: 96 },
  badge: { fontFamily: "Inter", fontWeight: 700, fontSize: 6.6 },
  sigName: { width: 168 }, sigMid: { width: 84, textAlign: "center" }, sigLine: { flex: 1 },
  // A drawn box, not U+2610: no text font reliably carries the ballot-box
  // glyph, and depending on one made @react-pdf fall back to Helvetica for
  // those two runs — visible in `pdffonts` as an unembedded Type 1 face.
  tickRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3 },
  tick: { width: 6, height: 6, borderWidth: 0.6, borderColor: "#6B7280" },
  note: { fontSize: 6.8, color: "#6B7280", marginTop: 7, lineHeight: 1.4 },
  footer: { position: "absolute", bottom: 22, left: 34, right: 34, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.5, borderTopColor: "#E5E7EB", paddingTop: 5, fontSize: 6.5, color: "#6B7280" },
  // No rotation: @react-pdf lays a rotated Text out glyph by glyph, and
  // pdftotext showed the watermark arriving as loose "F", "R", "U", "W" on
  // separate lines instead of one word. A horizontal band stays a single run,
  // so it is still one searchable string.
  mark2: { position: "absolute", top: 330, left: 0, right: 0, textAlign: "center", fontFamily: "Inter", fontWeight: 700, fontSize: 68, color: DB_RED, opacity: 0.1, letterSpacing: 6 },
});

export interface ChecklistPdfData {
  projektnummer: string;
  projektbezeichnung: string;
  stationsname: string;
  bahnhofsnummer: string;
  bahnhofsmanagement: string;
  projektstand: string;
  projektleitung: string;
  mode: string;
  termin: { datum: string; von: string; bis: string } | null;
  answers: Record<string, ChecklistAnswer | undefined>;
  reviews: GeneratedReview[];
  /** ISO date the export was made. Passed in so the document is deterministic. */
  generatedAt: string;
  /** Rendered with an ENTWURF watermark when false. */
  complete: boolean;
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.metaCell}>
      <Text style={s.metaKey}>{k}</Text>
      <Text style={s.metaVal}>{v || "—"}</Text>
    </View>
  );
}

function answerText(q: ChecklistQuestion, a: ChecklistAnswer | undefined): string {
  if (!a) return "—";
  const parts: string[] = [];
  if (a.answer) parts.push(a.answer);
  if (q.secondary && a.secondary) parts.push(`(2. Frage: ${a.secondary})`);
  return parts.length ? parts.join(" ") : "—";
}

export function ChecklistDocument({ data }: { data: ChecklistPdfData }) {
  const gewerke = CHECKLIST_QUESTIONS.filter((q) => q.kind === "gewerk");
  const admin = CHECKLIST_QUESTIONS.filter((q) => q.kind === "admin");
  const notes = CHECKLIST_QUESTIONS.find((q) => q.kind === "notes");
  const open = data.reviews.filter((r) => r.status === "offen");
  const byDept = new Map(data.reviews.map((r) => [r.department, r]));
  const stamp = new Date(data.generatedAt);
  const stampText = Number.isNaN(stamp.getTime())
    ? data.generatedAt
    : new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(stamp);

  const Header = () => (
    <View style={s.bar} fixed>
      <Text style={s.mark}>DB</Text>
      <View>
        <Text style={s.issuer}>{UNTERSCHRIFTENBLATT_ISSUER}</Text>
        <Text style={s.issuerSub}>Regionalbereich Mitte · Fachspezialistenprüfung</Text>
      </View>
    </View>
  );

  const Footer = () => (
    <View style={s.footer} fixed>
      <Text>
        {data.projektnummer || "ohne Projektnummer"} · {data.stationsname || "ohne Station"} ·
        erzeugt am {stampText}
      </Text>
      <Text render={({ pageNumber, totalPages }) => `Seite ${pageNumber} von ${totalPages}`} />
    </View>
  );

  return (
    <Document
      title={`Checkliste ${data.projektnummer || "Entwurf"}`}
      author={UNTERSCHRIFTENBLATT_ISSUER}
      subject={UNTERSCHRIFTENBLATT_TITLE}
      creator="Bahn Project Manager"
    >
      <Page size="A4" style={s.page}>
        <Header />
        {!data.complete && <Text style={s.mark2} fixed>ENTWURF</Text>}

        <Text style={s.title}>Checkliste zur Anmeldung einer Fachspezialistenprüfung</Text>
        <Text style={s.subtitle}>
          {data.mode}
          {data.complete ? "" : " · unvollständig, nicht zur Einreichung geeignet"}
        </Text>

        <View style={s.metaGrid}>
          <Meta k="Projektnummer" v={data.projektnummer} />
          <Meta k="Projektstand" v={data.projektstand} />
          <Meta k="Projektbezeichnung" v={data.projektbezeichnung} />
          <Meta k="Projektleitung" v={data.projektleitung} />
          <Meta k="Station" v={data.stationsname} />
          <Meta k="Bahnhofsnummer" v={data.bahnhofsnummer} />
          <Meta k="Bahnhofsmanagement" v={data.bahnhofsmanagement} />
          <Meta
            k="Termin"
            v={data.termin ? `${data.termin.datum}, ${data.termin.von}–${data.termin.bis}` : "ohne Projektvorstellung"}
          />
        </View>

        <Text style={s.h2}>Allgemein</Text>
        <View style={s.tHead}>
          <Text style={[s.th, s.cNr]}>Nr.</Text>
          <Text style={[s.th, s.cGewerk]}>Gewerk</Text>
          <Text style={[s.th, s.cFrage]}>Frage zum Projekt</Text>
          <Text style={[s.th, s.cAntwort]}>Antwort</Text>
          <Text style={[s.th, s.cKommentar]}>Kommentar</Text>
        </View>
        {admin.map((q) => (
          <View key={q.key} style={s.tr} wrap={false}>
            <Text style={[s.td, s.cNr]}>{q.nr}</Text>
            <Text style={[s.td, s.cGewerk]}>{q.gewerk}</Text>
            <Text style={[s.td, s.cFrage]}>{(q.question ?? "").replace(/\n/g, " ")}</Text>
            <Text style={[s.td, s.cAntwort]}>{answerText(q, data.answers[q.key])}</Text>
            <Text style={[s.td, s.cKommentar]}>{data.answers[q.key]?.comment ?? ""}</Text>
          </View>
        ))}

        <Text style={s.h2}>Gewerke — {open.length} von 14 Prüfungen erforderlich</Text>
        <View style={s.tHead}>
          <Text style={[s.th, s.cNr]}>Nr.</Text>
          <Text style={[s.th, s.cGewerk]}>Gewerk</Text>
          <Text style={[s.th, s.cFrage]}>Frage zum Projekt</Text>
          <Text style={[s.th, s.cAntwort]}>Antwort</Text>
          <Text style={[s.th, s.cKommentar]}>Kommentar</Text>
        </View>
        {gewerke.map((q) => {
          const required = q.department ? byDept.get(q.department)?.status === "offen" : false;
          return (
            <View key={q.key} style={s.tr} wrap={false}>
              <Text style={[s.td, s.cNr]}>{q.nr}</Text>
              <View style={s.cGewerk}>
                <Text style={s.td}>{q.gewerk}</Text>
                {q.department && (
                  <Text style={[s.td, s.badge, { color: required ? DB_RED : "#6B7280" }]}>
                    {q.department} · {required ? "Prüfung offen" : "nicht erforderlich"}
                  </Text>
                )}
              </View>
              <Text style={[s.td, s.cFrage]}>{(q.question ?? "").replace(/\n/g, " ")}</Text>
              <Text style={[s.td, s.cAntwort]}>{answerText(q, data.answers[q.key])}</Text>
              <Text style={[s.td, s.cKommentar]}>{data.answers[q.key]?.comment ?? ""}</Text>
            </View>
          );
        })}

        {notes && data.answers[notes.key]?.answer ? (
          <>
            <Text style={s.h2}>{notes.gewerk}</Text>
            <Text style={[s.td, { paddingHorizontal: 0 }]}>{data.answers[notes.key]?.answer}</Text>
          </>
        ) : null}

        <Footer />
      </Page>

      <Page size="A4" style={s.page}>
        <Header />
        {!data.complete && <Text style={s.mark2} fixed>ENTWURF</Text>}

        <Text style={s.title}>{UNTERSCHRIFTENBLATT_TITLE}</Text>
        <Text style={s.subtitle}>
          Projekt {data.projektnummer || "—"} · {data.stationsname || "—"}
        </Text>

        <View style={s.tHead}>
          <Text style={[s.th, s.sigName]}>Name / Funktion</Text>
          <Text style={[s.th, s.sigMid]}>Prüfung</Text>
          <Text style={[s.th, s.sigMid]}>Zustimmung</Text>
          <Text style={[s.th, s.sigLine]}>Datum / Unterschrift</Text>
        </View>
        {UNTERSCHRIFTENBLATT.map((block) => {
          const review = block.department ? byDept.get(block.department) : undefined;
          const required = review?.status === "offen";
          return (
            <View key={`${block.ou}-${block.role}`} style={[s.tr, { paddingVertical: 6 }]} wrap={false}>
              <View style={s.sigName}>
                <Text style={[s.td, { fontFamily: "Inter", fontWeight: 700 }]}>{block.role}</Text>
                <Text style={[s.td, { color: "#6B7280", fontSize: 6.6 }]}>
                  {block.ou}
                  {block.name ? ` · ${block.name}` : ""}
                </Text>
              </View>
              <Text style={[s.td, s.sigMid, s.badge, { color: required ? DB_RED : "#6B7280" }]}>
                {block.acknowledgeOnly
                  ? "zur Kenntnis"
                  : block.department
                    ? required
                      ? "erforderlich"
                      : "nicht erforderlich"
                    : "—"}
              </Text>
              <View style={[s.sigMid, s.tickRow]}>
                <Text style={[s.td, { color: "#6B7280" }]}>ja</Text>
                <View style={s.tick} />
                <Text style={[s.td, { color: "#6B7280" }]}>nein</Text>
                <View style={s.tick} />
              </View>
              <Text style={[s.td, s.sigLine, { color: "#9CA3AF" }]}>
                ______________________________
              </Text>
            </View>
          );
        })}

        <Text style={s.note}>
          Hinweis: {DEPARTMENTS_WITHOUT_SIGNATURE_BLOCK.join(" und ")} haben auf dem
          Unterschriftenblatt der Vorlage keinen eigenen Block. Ihre Prüfungen werden in der
          Projektübersicht geführt.
        </Text>

        {open.length > 0 && (
          <>
            <Text style={s.h2}>Benachrichtigte Fachbereiche</Text>
            {open.map((r) => {
              const people = recipientsFor(r.department);
              return (
                <View key={r.department} style={s.tr} wrap={false}>
                  <Text style={[s.td, { width: 110, fontFamily: "Inter", fontWeight: 700 }]}>
                    {r.department}
                  </Text>
                  <Text style={[s.td, s.cFrage, people.length ? {} : { color: DB_RED, fontFamily: "Inter", fontWeight: 700 }]}>
                    {people.length
                      ? people.map(displayName).join(", ")
                      : "keine E-Mail-Adresse hinterlegt — es wird niemand benachrichtigt"}
                  </Text>
                </View>
              );
            })}
          </>
        )}

        <Footer />
      </Page>
    </Document>
  );
}
