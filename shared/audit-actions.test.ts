import { describe, it, expect } from "vitest";
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LIST,
  AUDIT_TONE,
  auditTone,
  type AuditAction,
} from "./audit-actions";

describe("the audit vocabulary", () => {
  it("gives every action exactly one tone", () => {
    for (const action of AUDIT_ACTION_LIST) {
      expect(AUDIT_TONE[action], action).toBeDefined();
    }
    expect(Object.keys(AUDIT_TONE)).toHaveLength(AUDIT_ACTION_LIST.length);
  });

  it("has no two keys sharing a phrase — a duplicate would merge two events in the log", () => {
    expect(new Set(AUDIT_ACTION_LIST).size).toBe(AUDIT_ACTION_LIST.length);
  });

  it("resolves the phrases already written to existing local trails", () => {
    // Append-only storage: entries written before this vocabulary keep their
    // wording forever, and must not degrade to the fallback tone.
    expect(auditTone("Projekt erstellt")).toBe("create");
    expect(auditTone("Fachspezialistenprüfung angemeldet")).toBe("create");
  });

  it("falls back narrowly rather than inventing a category", () => {
    expect(auditTone("etwas völlig Unbekanntes")).toBe("update");
  });

  it("never claims a delivery or a print the app cannot observe", () => {
    // A mailto: hands the message to the user's client; a Teams deep link opens
    // a compose box; a PDF download is not a print job. The app learns none of
    // those outcomes, so no entry may assert them.
    for (const phrase of AUDIT_ACTION_LIST) {
      expect(phrase, phrase).not.toMatch(/gesendet|zugestellt|gedruckt|empfangen/);
    }
    expect(AUDIT_ACTIONS.mailGeoeffnet).toBe("E-Mail vorbereitet");
    expect(AUDIT_ACTIONS.teamsGeoeffnet).toBe("Teams-Nachricht vorbereitet");
    expect(AUDIT_ACTIONS.pdfErzeugt).toBe("PDF erzeugt");
  });

  it("covers every kind of event the app can produce", () => {
    // Adding a user-visible action without adding it here is the failure this
    // list exists to catch: the log silently stops describing what happened.
    const required: AuditAction[] = [
      AUDIT_ACTIONS.projektAngelegt,
      AUDIT_ACTIONS.projektAktualisiert,
      AUDIT_ACTIONS.projektGeloescht,
      AUDIT_ACTIONS.pruefungAktualisiert,
      AUDIT_ACTIONS.anmeldungEingereicht,
      AUDIT_ACTIONS.entwurfGespeichert,
      AUDIT_ACTIONS.terminGebucht,
      AUDIT_ACTIONS.pdfErzeugt,
      AUDIT_ACTIONS.exportErzeugt,
      AUDIT_ACTIONS.mailGeoeffnet,
      AUDIT_ACTIONS.teamsGeoeffnet,
    ];
    for (const action of required) expect(AUDIT_ACTION_LIST).toContain(action);
  });
});
