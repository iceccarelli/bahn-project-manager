import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import interBold from "./Inter-Bold.ttf?url";
import interRegular from "./Inter-Regular.ttf?url";
import { DB_RED } from "@shared/brand";
import { UNTERSCHRIFTENBLATT_ISSUER } from "@shared/checklist";
import { generatedLabel } from "@shared/generated-stamp";
import { deriveMaengel, stateOf, summarizeSection, summarizeTemplate } from "@shared/abnahme/summary";
import type { AbnahmeAnswers, AbnahmeHeader, ChecklistTemplate } from "@shared/abnahme/types";

/**
 * The Abnahmeprotokoll: one Technik's checklist, as answered, on paper.
 *
 * Built from the same (template, answers) pair the screen renders and the same
 * summarize/deriveMaengel functions the KPI row and Mängelliste use, so the
 * printed counts cannot differ from what the Prüfer saw. Layout, fonts, the
 * generation stamp and the ENTWURF watermark follow the Projektblatt and the
 * Checkliste: an Abnahme with unrated points still exports, marked as a draft,
 * because a tool that refuses to produce the page until everything is perfect
 * is a tool people work around with screenshots.
 */

Font.register({
  family: "Inter",
  fonts: [
    { src: interRegular, fontWeight: 400 },
    { src: interBold, fontWeight: 700 },
  ],
});
Font.registerHyphenationCallback((word) => [word]);

const s = StyleSheet.create({
  page: { paddingTop: 34, paddingBottom: 48, paddingHorizontal: 34, fontSize: 8, fontFamily: "Inter", color: "#111827" },
  bar: { flexDirection: "row", alignItems: "center", borderBottomWidth: 2, borderBottomColor: DB_RED, paddingBottom: 6, marginBottom: 10 },
  mark: { backgroundColor: DB_RED, color: "#FFFFFF", fontFamily: "Inter", fontWeight: 700, fontSize: 11, paddingHorizontal: 5, paddingVertical: 2.5, marginRight: 7 },
  issuer: { fontFamily: "Inter", fontWeight: 700, fontSize: 9 },
  issuerSub: { color: "#6B7280", fontSize: 7, marginTop: 1 },
  title: { fontFamily: "Inter", fontWeight: 700, fontSize: 15, marginBottom: 2 },
  nummer: { fontFamily: "Inter", fontWeight: 700, fontSize: 9, color: DB_RED, marginBottom: 2 },
  stampLine: { fontSize: 7.5, color: "#6B7280", marginBottom: 10 },
  h2: { fontFamily: "Inter", fontWeight: 700, fontSize: 9.5, marginTop: 12, marginBottom: 5 },
  metaGrid: { flexDirection: "row", flexWrap: "wrap", borderTopWidth: 0.5, borderTopColor: "#D1D5DB" },
  metaCell: { width: "50%", flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#E5E7EB", paddingVertical: 3 },
  metaKey: { width: 104, color: "#6B7280", fontSize: 7.5 },
  metaVal: { flex: 1, fontFamily: "Inter", fontWeight: 700, fontSize: 7.5 },
  tHead: { flexDirection: "row", backgroundColor: "#F3F4F6", borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: "#D1D5DB", paddingVertical: 3.5 },
  th: { fontFamily: "Inter", fontWeight: 700, fontSize: 6.8, color: "#374151", paddingHorizontal: 3 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#E5E7EB", paddingVertical: 3.5 },
  td: { fontSize: 7, paddingHorizontal: 3 },
  tdBold: { fontSize: 7, paddingHorizontal: 3, fontFamily: "Inter", fontWeight: 700 },
  section: { fontFamily: "Inter", fontWeight: 700, fontSize: 8.5, marginTop: 10, marginBottom: 3 },
  sectionSub: { fontSize: 7, color: "#6B7280", marginBottom: 3 },
  cNr: { width: 34 },
  cLabel: { flex: 1 },
  cStatus: { width: 54 },
  cMangel: { width: 170 },
  cNr2: { width: 22 },
  cRef: { width: 200 },
  cBesch: { flex: 1 },
  note: { fontSize: 6.8, color: "#6B7280", marginTop: 7, lineHeight: 1.4 },
  footer: { position: "absolute", bottom: 22, left: 34, right: 34, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.5, borderTopColor: "#E5E7EB", paddingTop: 5, fontSize: 6.5, color: "#6B7280" },
  watermark: { position: "absolute", top: 330, left: 0, right: 0, textAlign: "center", fontFamily: "Inter", fontWeight: 700, fontSize: 68, color: DB_RED, opacity: 0.1, letterSpacing: 6 },
});

export interface AbnahmePdfData {
  template: ChecklistTemplate;
  answers: AbnahmeAnswers;
  header: AbnahmeHeader;
  /** Project facts, "" when the Abnahme is not bound to a project. */
  projektnummer: string;
  station: string;
  projektleiter: string;
  pruefer: string;
  pruefDatum: string;
  /** The linked ITK Prüfbericht (laufende Nummer, canonical PDF-Code); null where none is linked or the Abnahme is free. */
  pruefbericht?: { nummer: string; pdfCode: string } | null;
  /** ISO instant of the export. Passed in so the document is deterministic. */
  generatedAt: string;
  generatedBy: string;
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.metaCell}>
      <Text style={s.metaKey}>{k}</Text>
      <Text style={s.metaVal}>{v || "—"}</Text>
    </View>
  );
}

export function AbnahmeDocument({ data }: { data: AbnahmePdfData }) {
  const { template, answers } = data;
  const stampText = generatedLabel(data.generatedAt);
  const sum = summarizeTemplate(template, answers);
  const maengel = deriveMaengel(template, answers);
  const complete = sum.nichtBewertet === 0;
  const who = data.projektnummer || data.station || "freie Abnahme";

  return (
    <Document
      title={`Abnahmeprotokoll ${template.technik} ${who}`}
      author={UNTERSCHRIFTENBLATT_ISSUER}
      subject={`Abnahmeprotokoll ITK ${template.technik} · Stand ${stampText}`}
      creator="Bahn Project Manager"
    >
      <Page size="A4" style={s.page}>
        <View style={s.bar} fixed>
          <Text style={s.mark}>DB</Text>
          <View>
            <Text style={s.issuer}>{UNTERSCHRIFTENBLATT_ISSUER}</Text>
            <Text style={s.issuerSub}>Abnahmeprotokoll ITK · Regionalbereich Mitte</Text>
          </View>
        </View>
        {!complete && (
          <Text style={s.watermark} fixed>
            ENTWURF
          </Text>
        )}

        <Text style={s.nummer}>{data.projektnummer || "ohne Projektbezug"}</Text>
        <Text style={s.title}>Abnahme {template.technik}</Text>
        <Text style={s.stampLine}>
          Stand der Daten: {stampText}
          {data.generatedBy ? ` · erzeugt von ${data.generatedBy}` : ""}
          {complete ? "" : " · unvollständig, nicht zur Abnahme geeignet"}
        </Text>

        <Text style={s.h2}>Anlagendaten</Text>
        <View style={s.metaGrid}>
          <Meta k="Station" v={data.station} />
          <Meta k="Gewerk / Anlage" v={data.header.gewerkAnlage} />
          <Meta k="Projektleitung" v={data.projektleiter} />
          <Meta k="Errichter (Firma)" v={data.header.errichter} />
          <Meta k="ITK-Prüfer" v={data.pruefer} />
          <Meta k="Prüfdatum" v={data.pruefDatum} />
          {data.pruefbericht && <Meta k="Prüfbericht-Nr." v={data.pruefbericht.nummer} />}
          {data.pruefbericht && <Meta k="PDF-Code" v={data.pruefbericht.pdfCode} />}
        </View>

        <Text style={s.h2}>Ergebnis</Text>
        <View style={s.metaGrid}>
          <Meta k="Fortschritt" v={`${sum.fortschritt} % (${sum.total - sum.nichtBewertet} von ${sum.total} Punkten bewertet)`} />
          <Meta k="Erfüllt" v={String(sum.erfuellt)} />
          <Meta k="Offen" v={`${sum.offen}${sum.offenOhneMangel ? ` (${sum.offenOhneMangel} ohne Mangelbeschreibung)` : ""}`} />
          <Meta k="Entfällt" v={String(sum.entfaellt)} />
          <Meta k="Nicht bewertet" v={String(sum.nichtBewertet)} />
          <Meta k="Checkliste" v={`${template.technik}, Version ${template.version}`} />
        </View>

        {maengel.length > 0 && (
          <>
            <Text style={s.h2}>Mängelliste ({maengel.length})</Text>
            <View style={s.tHead}>
              <Text style={[s.th, s.cNr2]}>Nr.</Text>
              <Text style={[s.th, s.cRef]}>Prüfpunkt</Text>
              <Text style={[s.th, s.cBesch]}>Mangel</Text>
            </View>
            {maengel.map((m) => (
              <View key={m.itemId} style={s.tr} wrap={false}>
                <Text style={[s.td, s.cNr2]}>{m.nr}</Text>
                <Text style={[s.td, s.cRef]}>{m.reference}</Text>
                <Text style={[s.td, s.cBesch]}>{m.beschreibung || "Keine Mangelbeschreibung"}</Text>
              </View>
            ))}
          </>
        )}

        <Text style={s.h2} minPresenceAhead={90}>
          Checkliste {template.technik}
        </Text>
        {template.sections.map((section) => {
          const ss = summarizeSection(section, answers);
          return (
            <View key={section.number}>
              <Text style={s.section} minPresenceAhead={60}>
                {section.number} {section.title}
              </Text>
              <Text style={s.sectionSub}>
                {ss.total - ss.nichtBewertet} von {ss.total} bewertet · {ss.offen} offen
              </Text>
              <View style={s.tHead}>
                <Text style={[s.th, s.cNr]}>Nr.</Text>
                <Text style={[s.th, s.cLabel]}>Prüfpunkt</Text>
                <Text style={[s.th, s.cStatus]}>Status</Text>
                <Text style={[s.th, s.cMangel]}>Mangel</Text>
              </View>
              {section.items.map((item) => {
                const st = stateOf(answers, item.id);
                return (
                  <View key={item.id} style={s.tr} wrap={false}>
                    <Text style={[s.td, s.cNr]}>{item.id}</Text>
                    <Text style={[s.td, s.cLabel]}>{item.label}</Text>
                    <Text style={[st.selected === "Offen" ? s.tdBold : s.td, s.cStatus]}>{st.selected ?? "nicht bewertet"}</Text>
                    <Text style={[s.td, s.cMangel]}>{st.selected === "Offen" ? st.mangel.trim() || "—" : ""}</Text>
                  </View>
                );
              })}
            </View>
          );
        })}

        <Text style={s.note}>
          Momentaufnahme aus dem Bahn Project Manager. Maßgeblich ist der Stand im System, nicht dieser Ausdruck.
        </Text>

        <View style={s.footer} fixed>
          <Text>
            Abnahme {template.technik} · {who} · erzeugt am {stampText}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Seite ${pageNumber} von ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export default AbnahmeDocument;
