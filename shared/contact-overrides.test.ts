import { describe, it, expect } from "vitest";
import {
  effectiveRecipients,
  normalizeOverride,
  overridesFor,
  reachesNobody,
  validateOverride,
  type RecipientOverride,
} from "./contact-overrides";
import { departmentsWithoutRecipients, recipientsFor } from "./contacts";

const NOW = "2026-08-24T10:00:00.000Z";
const lst = (mail: string): RecipientOverride => ({
  department: "LST",
  name: "A. Person",
  mail,
  addedBy: "Vincenzo Grimaldi",
  addedAt: NOW,
});

describe("the address the workbook does not have", () => {
  it("still reaches nobody for LST out of the box", () => {
    // The state this exists to close, asserted rather than assumed.
    expect(departmentsWithoutRecipients()).toEqual(["LST"]);
    expect(recipientsFor("LST")).toEqual([]);
    expect(reachesNobody(effectiveRecipients("LST", recipientsFor("LST"), []))).toBe(true);
  });

  it("reaches somebody once a person supplies one", () => {
    const supplied = [lst("s.beispiel@example.org")];
    const who = effectiveRecipients("LST", recipientsFor("LST"), supplied);
    expect(reachesNobody(who)).toBe(false);
    expect(who).toHaveLength(1);
    expect(who[0]?.source).toBe("ergaenzt");
    // Provenance travels with it: an address nobody can trace is an address
    // nobody can check.
    expect(who[0]?.addedBy).toBe("Vincenzo Grimaldi");
    expect(who[0]?.addedAt).toBe(NOW);
  });

  it("never lets a supplied address shadow one the workbook has", () => {
    const real = recipientsFor("ITK");
    expect(real.length).toBeGreaterThan(0);
    const hijack: RecipientOverride = {
      department: "ITK",
      name: "Nicht Emin",
      mail: real[0]?.mail ?? "x@y.de",
      addedBy: "jemand",
      addedAt: NOW,
    };
    const who = effectiveRecipients("ITK", real, [hijack]);
    // Same count, and every workbook address still labelled as such: an
    // override that could redirect a real notification is a power this must
    // not have.
    expect(who).toHaveLength(real.length);
    expect(who.every((c) => c.source === "hilfsdatei")).toBe(true);
  });

  it("adds alongside the workbook rather than replacing it", () => {
    const real = recipientsFor("ITK");
    const who = effectiveRecipients("ITK", real, [
      { ...lst("zusatz@example.org"), department: "ITK" },
    ]);
    expect(who).toHaveLength(real.length + 1);
    expect(who.filter((c) => c.source === "hilfsdatei")).toHaveLength(real.length);
  });

  it("refuses everything that is not an address a person would answer", () => {
    expect(validateOverride({ department: "LST", name: "A", mail: "s.b@example.org" })).toBeNull();
    expect(validateOverride({ department: "", name: "A", mail: "s.b@example.org" })).toBe("empty-department");
    expect(validateOverride({ department: "LST", name: " ", mail: "s.b@example.org" })).toBe("empty-name");
    expect(validateOverride({ department: "LST", name: "A", mail: "" })).toBe("empty-mail");
    for (const bad of ["kein-at", "a@b", "a@@b.de", "a b@c.de", "a@b.d", "a@b,c.de"]) {
      expect(validateOverride({ department: "LST", name: "A", mail: bad }), bad).toBe("malformed-mail");
    }
    for (const placeholder of ["test@test.de", "noreply@deutschebahn.com", "A@A.de"]) {
      expect(
        validateOverride({ department: "LST", name: "A", mail: placeholder }),
        placeholder,
      ).toBe("placeholder-mail");
    }
  });

  it("normalises so one address cannot be stored two ways", () => {
    const a = normalizeOverride(
      { department: " LST ", name: "  Anna   Beispiel ", mail: "  Anna.Beispiel@Example.ORG " },
      "  ",
      NOW,
    );
    expect(a).toEqual({
      department: "LST",
      name: "Anna Beispiel",
      mail: "anna.beispiel@example.org",
      addedBy: "unbekannt",
      addedAt: NOW,
    });
  });

  it("keeps one department's addresses out of another's", () => {
    const mixed = [lst("a@example.org"), { ...lst("b@example.org"), department: "BIM" }];
    expect(overridesFor(mixed, "LST").map((o) => o.mail)).toEqual(["a@example.org"]);
    expect(overridesFor(mixed, "BIM").map((o) => o.mail)).toEqual(["b@example.org"]);
    expect(overridesFor(mixed, "EEA")).toEqual([]);
  });

  it("never invents an address for a department that has none", () => {
    // The rule the whole project turns on: no derivation, no pattern, no
    // vorname.nachname@deutschebahn.com. Empty in, empty out.
    for (const d of departmentsWithoutRecipients()) {
      expect(effectiveRecipients(d, recipientsFor(d), [])).toEqual([]);
    }
  });
});
