import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import interBold from "./Inter-Bold.ttf?url";
import interRegular from "./Inter-Regular.ttf?url";
import { DB_RED } from "@shared/brand";
import { UNTERSCHRIFTENBLATT_ISSUER } from "@shared/checklist";
import { generatedLabel } from "@shared/generated-stamp";

/**
 * The Projektblatt: one project, on paper.
 *
 * The detail dialog is the screen where a manager sees everything about a
 * project at once, and the thing they then want is that same view in a form
 * they can attach to a mail, take into a meeting or file. Screenshotting a
 * dialog produces a picture with no Projektnummer in the filename and no
 * indication of when it was taken; this produces a searchable A4 page that
 * says both.
 *
 * Every value comes from the same record the dialog renders — the document is
 * built from the props the caller already has, so it cannot disagree with the
 * screen it was printed from.
 *
 * The generation stamp is deliberately prominent rather than a footnote. A
 * project sheet is a snapshot of live data: eleven of the fourteen
 * Fachprüfungen can change the day after it is printed, so the reader has to
 * be able to see, without hunting, how old the sheet in their hand is. It
 * appears under the title AND in the footer of every page.
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
  page: {
    paddingTop: 34,
    paddingBottom: 48,
    paddingHorizontal: 34,
    fontSize: 8,
    fontFamily: "Inter",
    color: "#111827",
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: DB_RED,
    paddingBottom: 6,
    marginBottom: 10,
  },
  mark: {
    backgroundColor: DB_RED,
    color: "#FFFFFF",
    fontFamily: "Inter",
    fontWeight: 700,
    fontSize: 11,
    paddingHorizontal: 5,
    paddingVertical: 2.5,
    marginRight: 7,
  },
  issuer: { fontFamily: "Inter", fontWeight: 700, fontSize: 9 },
  issuerSub: { color: "#6B7280", fontSize: 7, marginTop: 1 },
  title: { fontFamily: "Inter", fontWeight: 700, fontSize: 15, marginBottom: 2 },
  nummer: { fontFamily: "Inter", fontWeight: 700, fontSize: 9, color: DB_RED, marginBottom: 2 },
  stampLine: { fontSize: 7.5, color: "#6B7280", marginBottom: 10 },
  desc: { fontSize: 8.5, marginBottom: 10, lineHeight: 1.4 },
  h2: { fontFamily: "Inter", fontWeight: 700, fontSize: 9.5, marginTop: 12, marginBottom: 5 },

  metaGrid: { flexDirection: "row", flexWrap: "wrap", borderTopWidth: 0.5, borderTopColor: "#D1D5DB" },
  metaCell: {
    width: "50%",
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#E5E7EB",
    paddingVertical: 3,
  },
  metaKey: { width: 104, color: "#6B7280", fontSize: 7.5 },
  metaVal: { flex: 1, fontFamily: "Inter", fontWeight: 700, fontSize: 7.5 },

  tHead: {
    flexDirection: "row",
    backgroundColor: "#F3F4F6",
    borderTopWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: "#D1D5DB",
    paddingVertical: 3.5,
  },
  th: { fontFamily: "Inter", fontWeight: 700, fontSize: 6.8, color: "#374151", paddingHorizontal: 3 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#E5E7EB", paddingVertical: 3.5 },
  td: { fontSize: 7, paddingHorizontal: 3 },
  cGewerk: { width: 92 },
  cStatus: { width: 92 },
  cPruefer: { width: 108 },
  cDatum: { width: 58 },
  cKontakt: { flex: 1 },

  kommentar: {
    borderWidth: 0.5,
    borderColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
    padding: 6,
    fontSize: 7.5,
    lineHeight: 1.45,
  },
  note: { fontSize: 6.8, color: "#6B7280", marginTop: 7, lineHeight: 1.4 },
  footer: {
    position: "absolute",
    bottom: 22,
    left: 34,
    right: 34,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.5,
    borderTopColor: "#E5E7EB",
    paddingTop: 5,
    fontSize: 6.5,
    color: "#6B7280",
  },
});

export interface ProjectPdfReview {
  department: string;
  status: string;
  prueferName: string;
  pruefDatum: string;
  /** Address the app would write to for this Gewerk, or "" when there is none. */
  kontakt: string;
}

export interface ProjectPdfData {
  projektnummer: string;
  station: string;
  projektbeschreibung: string;
  bahnhofsmanagement: string;
  bahnhofsnummer: string;
  streckennummer: string;
  projektstand: string;
  projektleiter: string;
  terminProjektvorstellung: string;
  kommentar: string;
  projektLink: string;
  reviews: ProjectPdfReview[];
  openCount: number;
  blockedCount: number;
  /** ISO instant of the export. Passed in so the document is deterministic. */
  generatedAt: string;
  /** Who pressed the button, when the app knows. */
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

export function ProjectDocument({ data }: { data: ProjectPdfData }) {
  const stampText = generatedLabel(data.generatedAt);

  return (
    <Document
      title={`Projektblatt ${data.projektnummer || data.station}`}
      author={UNTERSCHRIFTENBLATT_ISSUER}
      subject={`Projektblatt · Stand ${stampText}`}
      creator="Bahn Project Manager"
    >
      <Page size="A4" style={s.page}>
        <View style={s.bar} fixed>
          <Text style={s.mark}>DB</Text>
          <View>
            <Text style={s.issuer}>{UNTERSCHRIFTENBLATT_ISSUER}</Text>
            <Text style={s.issuerSub}>Projektblatt · Regionalbereich Mitte</Text>
          </View>
        </View>

        <Text style={s.nummer}>{data.projektnummer || "ohne Projektnummer"}</Text>
        <Text style={s.title}>{data.station || "Ohne Station"}</Text>
        {/* Directly under the title, not only in the footer: this sheet is a
            snapshot of data that moves, and the reader needs the age of it
            without going looking. */}
        <Text style={s.stampLine}>
          Stand der Daten: {stampText}
          {data.generatedBy ? ` · erzeugt von ${data.generatedBy}` : ""}
        </Text>

        {data.projektbeschreibung ? <Text style={s.desc}>{data.projektbeschreibung}</Text> : null}

        <Text style={s.h2}>Stammdaten</Text>
        <View style={s.metaGrid}>
          <Meta k="Region / BM" v={data.bahnhofsmanagement} />
          <Meta k="Projektstand" v={data.projektstand} />
          <Meta k="Bahnhofsnummer" v={data.bahnhofsnummer} />
          <Meta k="Streckennummer" v={data.streckennummer} />
          <Meta k="Projektleitung" v={data.projektleiter} />
          <Meta k="Termin Projektvorstellung" v={data.terminProjektvorstellung} />
          <Meta k="Offene Prüfungen" v={String(data.openCount)} />
          <Meta k="Blockierte Prüfungen" v={String(data.blockedCount)} />
        </View>

        <Text style={s.h2}>Fachprüfungen ({data.reviews.length})</Text>
        <View style={s.tHead} fixed>
          <Text style={[s.th, s.cGewerk]}>Gewerk</Text>
          <Text style={[s.th, s.cStatus]}>Status</Text>
          <Text style={[s.th, s.cPruefer]}>Prüfer</Text>
          <Text style={[s.th, s.cDatum]}>Prüfdatum</Text>
          <Text style={[s.th, s.cKontakt]}>Kontakt</Text>
        </View>
        {data.reviews.map((r) => (
          <View key={r.department} style={s.tr} wrap={false}>
            <Text style={[s.td, s.cGewerk]}>{r.department}</Text>
            <Text style={[s.td, s.cStatus]}>{r.status || "—"}</Text>
            <Text style={[s.td, s.cPruefer]}>{r.prueferName || "—"}</Text>
            <Text style={[s.td, s.cDatum]}>{r.pruefDatum || "—"}</Text>
            <Text style={[s.td, s.cKontakt]}>{r.kontakt || "keine Adresse hinterlegt"}</Text>
          </View>
        ))}

        {data.kommentar ? (
          <>
            <Text style={s.h2}>Kommentar</Text>
            <Text style={s.kommentar}>{data.kommentar}</Text>
          </>
        ) : null}

        {data.projektLink ? (
          <>
            <Text style={s.h2}>Projektlink</Text>
            <Text style={s.td}>{data.projektLink}</Text>
          </>
        ) : null}

        <Text style={s.note}>
          Momentaufnahme aus dem Bahn Project Manager. Status, Prüfer und Prüfdaten ändern sich
          laufend — maßgeblich ist immer der Stand im System, nicht dieser Ausdruck.
        </Text>

        <View style={s.footer} fixed>
          <Text>
            {data.projektnummer || data.station} · erzeugt am {stampText}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Seite ${pageNumber} von ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export default ProjectDocument;
