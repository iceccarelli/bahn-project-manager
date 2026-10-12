import { describe, expect, it } from "vitest";
import { filterTemplate } from "./filter";
import { pruneAnswers } from "./persistence";
import { deriveMaengel, summarizeTemplate } from "./summary";
import { templateFor } from "./templates";
import type { AbnahmeAnswers } from "./types";

const zim = templateFor("ZIM");
if (!zim) throw new Error("ZIM template missing");

describe("summarizeTemplate", () => {
  it("is all 'nicht bewertet' with no answers", () => {
    expect(summarizeTemplate(zim, {})).toEqual({
      total: 93, erfuellt: 0, offen: 0, entfaellt: 0, nichtBewertet: 93, offenOhneMangel: 0, fortschritt: 0,
    });
  });

  it("counts every status and flags Offen without a Mangel", () => {
    const answers: AbnahmeAnswers = {
      "1.1.1": { selected: "Erfüllt", mangel: "" },
      "1.1.2": { selected: "Offen", mangel: "  " },
      "1.1.3": { selected: "Offen", mangel: "Nachweis fehlt" },
      "1.1.4": { selected: "Entfällt", mangel: "" },
    };
    const s = summarizeTemplate(zim, answers);
    expect(s).toMatchObject({ erfuellt: 1, offen: 2, entfaellt: 1, nichtBewertet: 89, offenOhneMangel: 1, fortschritt: 4 });
    expect(s.erfuellt + s.offen + s.entfaellt + s.nichtBewertet).toBe(s.total);
  });
});

describe("deriveMaengel", () => {
  it("numbers open items in checklist order", () => {
    const m = deriveMaengel(zim, {
      "1.2.1": { selected: "Offen", mangel: " Mast schief " },
      "1.1.5": { selected: "Offen", mangel: "" },
    });
    expect(m.map((x) => [x.nr, x.itemId, x.beschreibung])).toEqual([[1, "1.1.5", ""], [2, "1.2.1", "Mast schief"]]);
  });
});

describe("filterTemplate", () => {
  it("finds without umlauts and drops empty sections", () => {
    const r = filterTemplate(zim, {}, "pruefkriterien elektrotechnik", "alle");
    expect(r.map((x) => x.section.number)).toEqual(["1.5"]);
  });
  it("matches the Mangel text and honours the status filter", () => {
    const answers: AbnahmeAnswers = { "1.2.1": { selected: "Offen", mangel: "Rost am Fuß" } };
    expect(filterTemplate(zim, answers, "rost", "offen").flatMap((x) => x.items.map((i) => i.id))).toEqual(["1.2.1"]);
    expect(filterTemplate(zim, answers, "rost", "erfuellt")).toEqual([]);
    expect(filterTemplate(zim, answers, "", "offen")).toHaveLength(1);
  });
  it("'nicht-bewertet' excludes answered items", () => {
    const r = filterTemplate(zim, { "1.1.1": { selected: "Erfüllt", mangel: "" } }, "", "nicht-bewertet");
    expect(r.flatMap((x) => x.items).length).toBe(92);
  });
});

describe("pruneAnswers", () => {
  it("drops unknown ids and empty entries", () => {
    const out = pruneAnswers(
      { "1.1.1": { selected: "Erfüllt", mangel: "" }, "9.9.9": { selected: "Offen", mangel: "x" }, "1.1.2": { selected: null, mangel: "" } },
      new Set(["1.1.1", "1.1.2"]),
    );
    expect(Object.keys(out)).toEqual(["1.1.1"]);
  });
});
