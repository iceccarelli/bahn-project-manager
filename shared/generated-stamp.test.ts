import { describe, it, expect } from "vitest";
import {
  generatedLabel,
  fileStamp,
  documentFilename,
  generatedFooter,
  safeFilePart,
} from "./generated-stamp";

/** 22 August 2026, 12:07 UTC = 14:07 in Berlin (CEST, UTC+2). */
const INSTANT = new Date("2026-08-22T12:07:31.000Z");
/** 15 January 2026, 12:07 UTC = 13:07 in Berlin (CET, UTC+1). */
const WINTER = new Date("2026-01-15T12:07:00.000Z");

describe("generatedLabel", () => {
  it("prints German date AND time", () => {
    expect(generatedLabel(INSTANT)).toBe("22.08.2026, 14:07 Uhr");
  });

  it("follows Berlin across the daylight-saving boundary", () => {
    expect(generatedLabel(WINTER)).toBe("15.01.2026, 13:07 Uhr");
  });

  it("accepts an ISO string as well as a Date", () => {
    expect(generatedLabel(INSTANT.toISOString())).toBe(generatedLabel(INSTANT));
  });

  it("says so rather than throwing on an unusable value", () => {
    expect(generatedLabel("not a date")).toBe("unbekannt");
  });
});

describe("fileStamp", () => {
  it("is sortable, and carries the time so two exports a day are two files", () => {
    expect(fileStamp(INSTANT)).toBe("2026-08-22_1407");
    expect(fileStamp(WINTER)).toBe("2026-01-15_1307");
  });

  it("distinguishes two exports of the same project on the same day", () => {
    const a = fileStamp(new Date("2026-08-22T07:00:00Z"));
    const b = fileStamp(new Date("2026-08-22T13:00:00Z"));
    expect(a).not.toBe(b);
  });

  it("uses 24-hour time, never a 12-hour clock with an am/pm suffix", () => {
    expect(fileStamp(new Date("2026-08-22T20:05:00Z"))).toBe("2026-08-22_2205");
  });
});

describe("documentFilename", () => {
  it("puts the stamp last and keeps the identifying parts readable", () => {
    expect(documentFilename("Projektblatt", ["G.011540063", "Langenselbold"], INSTANT)).toBe(
      "Projektblatt_G.011540063_Langenselbold_2026-08-22_1407.pdf",
    );
  });

  it("drops empty parts instead of leaving separators behind", () => {
    expect(documentFilename("Checkliste", [null, "", "Kassel"], INSTANT)).toBe(
      "Checkliste_Kassel_2026-08-22_1407.pdf",
    );
  });

  it("sanitises anything a filesystem would reject", () => {
    expect(safeFilePart("VST Wiesbaden/Biebrich „Rhein\"")).toBe("VST_Wiesbaden_Biebrich_Rhein");
    expect(documentFilename("Export", ["a/b:c"], INSTANT, "csv")).toBe(
      "Export_a_b_c_2026-08-22_1407.csv",
    );
  });
});

describe("generatedFooter", () => {
  it("names the moment, and the person when there is one", () => {
    expect(generatedFooter(INSTANT)).toBe(
      "Erzeugt am 22.08.2026, 14:07 Uhr · Bahn Project Manager",
    );
    expect(generatedFooter(INSTANT, "Vincenzo Grimaldi")).toBe(
      "Erzeugt am 22.08.2026, 14:07 Uhr von Vincenzo Grimaldi · Bahn Project Manager",
    );
  });

  it("ignores a blank name rather than printing a dangling 'von'", () => {
    expect(generatedFooter(INSTANT, "   ")).toBe(generatedFooter(INSTANT));
  });
});
