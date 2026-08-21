/**
 * Pins the contact join against the real workbook and the real project data.
 *
 * The point of these numbers is that they are measured, not chosen. If an
 * address is added to Hilfsdatei or a Prüfer is renamed in the source, the
 * counts move and the test says so — which is the signal that the mail layer's
 * reach has changed.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CONTACTS } from "./contacts";
import {
  resolveContact,
  contactOf,
  resolutionNote,
  mailtoHref,
  teamsChatHref,
  AMBIGUOUS_SURNAMES,
} from "./contact-resolution";

const surname = (s: string) => s.trim().toLowerCase().split(/\s+/).filter(Boolean).pop() ?? "";

describe("Hilfsdatei surnames", () => {
  const named = CONTACTS.filter((c) => c.name.trim() !== "");

  it("has 48 named contacts and 3 unnamed group mailboxes", () => {
    expect(named).toHaveLength(48);
    expect(CONTACTS.length - named.length).toBe(3);
  });

  it("carries no duplicate surname, which is what makes surname matching safe", () => {
    const counts = new Map<string, string[]>();
    for (const c of named) {
      const s = surname(c.name);
      counts.set(s, [...(counts.get(s) ?? []), c.name]);
    }
    const dupes = [...counts.entries()].filter(([, v]) => v.length > 1);
    expect(dupes).toEqual([]);
    expect(counts.size).toBe(48);
    expect(AMBIGUOUS_SURNAMES).toEqual([]);
  });
});

describe("resolveContact", () => {
  it("matches a full name exactly", () => {
    const r = resolveContact("Emin Er");
    expect(r.kind).toBe("exact");
    expect(contactOf(r)?.mail).toBe("emin.er@deutschebahn.com");
  });

  it("matches a surname-only Prüfer to the one person who holds it", () => {
    const r = resolveContact("Er");
    expect(r.kind).toBe("surname");
    expect(contactOf(r)?.name).toBe("Emin Er");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(contactOf(resolveContact("  hartung "))?.name).toBe("Stephan Hartung");
    expect(contactOf(resolveContact("STEPHAN HARTUNG"))?.name).toBe("Stephan Hartung");
  });

  it("classifies the workbook's non-person values as placeholders", () => {
    for (const v of ["Zuordnung erforderlich", "Zentrale", "BSB des BM´s"]) {
      const r = resolveContact(v);
      expect(r.kind, v).toBe("placeholder");
      expect(contactOf(r)).toBeNull();
    }
  });

  it("never invents an address for a name it does not know", () => {
    const r = resolveContact("Colak");
    expect(r.kind).toBe("unknown");
    expect(contactOf(r)).toBeNull();
    expect(resolutionNote(r)).toBe("Keine Adresse in der Hilfsdatei hinterlegt");
  });

  it("reports an empty name rather than throwing", () => {
    for (const v of [null, undefined, "", "   "]) {
      expect(resolveContact(v).kind).toBe("empty");
    }
  });
});

describe("links", () => {
  const c = { row: 13, group: "ITK", name: "Emin Er", mail: "emin.er@deutschebahn.com" };

  it("builds a mailto with an encoded subject", () => {
    expect(mailtoHref(c, "Projekt G.011551488 – ITK")).toBe(
      "mailto:emin.er@deutschebahn.com?subject=Projekt+G.011551488+%E2%80%93+ITK",
    );
  });

  it("omits the query entirely when there is no subject and no body", () => {
    expect(mailtoHref(c)).toBe("mailto:emin.er@deutschebahn.com");
  });

  it("builds a Teams chat deep link from the address already on file", () => {
    expect(teamsChatHref(c)).toBe(
      "https://teams.microsoft.com/l/chat/0/0?users=emin.er%40deutschebahn.com",
    );
  });
});

/**
 * The reach measurement. These are the numbers the mail layer will inherit,
 * so they are asserted against the shipped data.json rather than a fixture.
 */
describe("reach across the real review data", () => {
  const dataPath = path.resolve(__dirname, "..", "client", "public", "data.json");
  const projects: Array<{ reviews?: Array<{ prueferName?: string | null }> }> = JSON.parse(
    fs.readFileSync(dataPath, "utf8"),
  ).projects;

  const names = new Map<string, number>();
  for (const p of projects) {
    for (const r of p.reviews ?? []) {
      const n = (r.prueferName ?? "").trim();
      if (n) names.set(n, (names.get(n) ?? 0) + 1);
    }
  }

  const tally = { exact: 0, surname: 0, placeholder: 0, unknown: 0, ambiguous: 0, empty: 0 };
  const rows = { ...tally };
  for (const [n, count] of names) {
    const kind = resolveContact(n).kind;
    tally[kind] += 1;
    rows[kind] += count;
  }

  it("sees 44 distinct Prüfer names over 10,489 review rows", () => {
    expect(names.size).toBe(44);
    expect([...names.values()].reduce((a, b) => a + b, 0)).toBe(10_489);
  });

  it("resolves 29 of them — 6,855 rows — to a real address", () => {
    expect(tally.exact + tally.surname).toBe(29);
    expect(rows.exact + rows.surname).toBe(6_855);
  });

  it("classifies 3 names — 2,799 rows — as placeholders rather than people", () => {
    expect(tally.placeholder).toBe(3);
    expect(rows.placeholder).toBe(2_799);
  });

  it("leaves exactly 12 unresolved names, over 835 rows", () => {
    expect(tally.unknown).toBe(12);
    expect(rows.unknown).toBe(835);
  });

  it("accounts for every name and every row", () => {
    expect(tally.exact + tally.surname + tally.placeholder + tally.unknown + tally.ambiguous).toBe(
      names.size,
    );
    expect(rows.exact + rows.surname + rows.placeholder + rows.unknown + rows.ambiguous).toBe(
      10_489,
    );
  });
});
