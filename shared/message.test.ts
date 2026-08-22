import { describe, it, expect } from "vitest";
import {
  messageSubject,
  messageBody,
  mailtoWithContext,
  teamsChatWithContext,
} from "./message";

const FULL = {
  projektnummer: "G.011540063",
  station: "Langenselbold",
  department: "ITK",
  bahnhofsmanagement: "Kassel",
  projektstand: "EP",
  projektbeschreibung: "ABS HANAU-GELNHAUSEN",
  terminProjektvorstellung: "28.05.2024",
  status: "offen",
  prueferName: "Emin Er",
  pruefDatum: "28.05.2024",
  absender: "Vincenzo Grimaldi",
  href: "https://bpm.example/projects?q=G.011540063",
  generatedAt: "22.08.2026, 14:07 Uhr",
};

describe("messageSubject", () => {
  it("leads with the Projektnummer, which is what a recipient searches for", () => {
    expect(messageSubject(FULL)).toBe("Projekt G.011540063 – Langenselbold – ITK");
  });

  it("drops the parts that are absent instead of leaving separators", () => {
    expect(messageSubject({ station: "Kassel Hbf" })).toBe("Projekt – Kassel Hbf");
    expect(messageSubject({})).toBe("Projekt");
  });
});

describe("messageBody", () => {
  const body = messageBody(FULL);

  it("names the Fachprüfung it is about", () => {
    expect(body).toContain("es geht um die ITK-Fachprüfung im folgenden Projekt:");
  });

  it("carries every fact the recipient needs to answer without opening anything", () => {
    for (const line of [
      "Projektnummer: G.011540063",
      "Station: Langenselbold",
      "Bahnhofsmanagement: Kassel",
      "Projektstand: EP",
      "Beschreibung: ABS HANAU-GELNHAUSEN",
      "Termin Projektvorstellung: 28.05.2024",
      "Status ITK: offen",
      "Prüfer: Emin Er",
      "Prüfdatum: 28.05.2024",
    ]) {
      expect(body, line).toContain(line);
    }
  });

  it("says where it came from, when, and how to get back", () => {
    expect(body).toContain("Erstellt aus dem Bahn Project Manager am 22.08.2026, 14:07 Uhr.");
    expect(body).toContain("Projekt öffnen: https://bpm.example/projects?q=G.011540063");
  });

  it("omits a field rather than filling it with a placeholder", () => {
    const sparse = messageBody({ projektnummer: "G.1", station: "X" });
    expect(sparse).toContain("Projektnummer: G.1");
    expect(sparse).not.toMatch(/Projektstand/);
    expect(sparse).not.toMatch(/undefined|null|—/);
  });

  it("drops the Fachprüfung block entirely when the message is about the project", () => {
    const b = messageBody({ ...FULL, department: null });
    expect(b).toContain("es geht um das folgende Projekt:");
    expect(b).not.toMatch(/^Status/m);
    expect(b).not.toMatch(/^Prüfer:/m);
  });

  it("uses LF only — a CRLF survives percent-encoding as literal characters", () => {
    expect(body).not.toContain("\r");
  });
});

describe("links", () => {
  it("puts subject AND body into the mailto", () => {
    const href = mailtoWithContext("emin.er@deutschebahn.com", FULL);
    expect(href.startsWith("mailto:emin.er@deutschebahn.com?")).toBe(true);
    const q = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    expect(q.get("subject")).toBe("Projekt G.011540063 – Langenselbold – ITK");
    expect(q.get("body")).toContain("Projektnummer: G.011540063");
  });

  it("repeats the subject as the first line of a Teams message, which has no subject field", () => {
    const href = teamsChatWithContext("emin.er@deutschebahn.com", FULL);
    const q = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    expect(q.get("users")).toBe("emin.er@deutschebahn.com");
    expect(q.get("message")?.startsWith("Projekt G.011540063 – Langenselbold – ITK\n\n")).toBe(true);
    expect(q.get("message")).toContain("Status ITK: offen");
  });

  it("encodes the umlauts and the en dash rather than emitting them raw", () => {
    const href = mailtoWithContext("a@b.de", FULL);
    expect(href).not.toMatch(/[–ü]/);
  });
});
