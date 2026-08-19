import { describe, expect, it } from "vitest";
import { applyHoldRelease, parseUnavailable } from "./useSchedule";

/**
 * The release rule comes from DieseArbeitsmappe.Workbook_Open: a
 * "Vorgebucht für IM/IT" hold survives only while the slot is more than 8 days
 * away. Getting it wrong either hides bookable slots or lets someone book a
 * slot that is still reserved.
 */
describe("applyHoldRelease", () => {
  const today = new Date("2026-08-19T00:00:00Z");

  it("never touches Frei or Gebucht", () => {
    expect(applyHoldRelease("Frei", "2026-12-01", today)).toEqual({ status: "Frei", released: false });
    expect(applyHoldRelease("Gebucht", "2026-08-25", today)).toEqual({
      status: "Gebucht",
      released: false,
    });
  });

  it("keeps a hold that is more than 8 days out", () => {
    expect(applyHoldRelease("Vorgebucht für IM", "2026-08-28", today)).toEqual({
      status: "Vorgebucht für IM",
      released: false,
    });
  });

  it("releases a hold on the 8-day boundary", () => {
    // VBA: If (Date + 8) < Datum Then keep Else release  →  exactly +8 releases
    expect(applyHoldRelease("Vorgebucht für IT", "2026-08-27", today)).toEqual({
      status: "Frei",
      released: true,
    });
  });

  it("releases a hold inside the window", () => {
    expect(applyHoldRelease("Vorgebucht für IM", "2026-08-20", today).status).toBe("Frei");
  });
});

describe("parseUnavailable", () => {
  it("reads the constraint notes the workbook actually contains", () => {
    expect(parseUnavailable("TBQ nicht verfügbar")).toEqual(["TBQ"]);
    expect(parseUnavailable("Baubetriebstechnologie und -planung nicht verfügbar")).toEqual([
      "Baubetriebstechnologie",
      "planung",
    ]);
    expect(parseUnavailable("TBQ nicht verfügbar (ganztägige Veranstaltung)")).toEqual(["TBQ"]);
  });

  it("returns nothing for a note that is not an availability constraint", () => {
    expect(parseUnavailable("wird Mittwoch angemeldet (Alexandra Gartmann)")).toEqual([]);
    expect(parseUnavailable(null)).toEqual([]);
  });
});
