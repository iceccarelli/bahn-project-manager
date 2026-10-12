import { describe, expect, it } from "vitest";
import { MAX_MANGEL, reduce, type AbnahmeState } from "./state";

const EMPTY: AbnahmeState = { answers: {}, header: { gewerkAnlage: "", errichter: "" } };

describe("reduce", () => {
  it("sets and clears a status; a cleared item leaves no entry", () => {
    const a = reduce(EMPTY, { type: "status", itemId: "1.1.1", selected: "Erfüllt" });
    expect(a.answers["1.1.1"]).toEqual({ selected: "Erfüllt", mangel: "" });
    expect(reduce(a, { type: "status", itemId: "1.1.1", selected: null }).answers).toEqual({});
  });

  it("only accepts Mangel text while the item is Offen", () => {
    expect(reduce(EMPTY, { type: "mangel", itemId: "1.1.1", mangel: "x" })).toBe(EMPTY);
    const offen = reduce(EMPTY, { type: "status", itemId: "1.1.1", selected: "Offen" });
    const withText = reduce(offen, { type: "mangel", itemId: "1.1.1", mangel: "Nachweis fehlt" });
    expect(withText.answers["1.1.1"]?.mangel).toBe("Nachweis fehlt");
  });

  it("drops the Mangel text when the item leaves Offen", () => {
    let s = reduce(EMPTY, { type: "status", itemId: "1.1.1", selected: "Offen" });
    s = reduce(s, { type: "mangel", itemId: "1.1.1", mangel: "weg" });
    s = reduce(s, { type: "status", itemId: "1.1.1", selected: "Entfällt" });
    expect(s.answers["1.1.1"]).toEqual({ selected: "Entfällt", mangel: "" });
  });

  it("bounds Mangel and header lengths", () => {
    const offen = reduce(EMPTY, { type: "status", itemId: "a", selected: "Offen" });
    expect(reduce(offen, { type: "mangel", itemId: "a", mangel: "x".repeat(MAX_MANGEL + 50) }).answers.a?.mangel).toHaveLength(MAX_MANGEL);
    expect(reduce(EMPTY, { type: "header", field: "errichter", value: "y".repeat(300) }).header.errichter).toHaveLength(200);
  });

  it("reset clears answers but keeps the header", () => {
    let s = reduce(EMPTY, { type: "header", field: "errichter", value: "Fa. X" });
    s = reduce(s, { type: "status", itemId: "a", selected: "Erfüllt" });
    expect(reduce(s, { type: "reset" })).toEqual({ answers: {}, header: { gewerkAnlage: "", errichter: "Fa. X" } });
  });
});
