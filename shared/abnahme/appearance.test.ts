import { describe, expect, it } from "vitest";
import { ABNAHME_STATUS_TONE, ABNAHME_TOGGLE_ON_CLASS, abnahmeBadgeClass, prefixToggleOn } from "./appearance";
import { ABNAHME_STATUS } from "./types";

describe("Abnahme appearance", () => {
  for (const status of ABNAHME_STATUS) {
    it(`${status}: toggle classes are exactly the tone badge, prefixed`, () => {
      expect(ABNAHME_TOGGLE_ON_CLASS[status]).toBe(prefixToggleOn(abnahmeBadgeClass(status)));
    });
  }
  it("maps Erfüllt/Offen/Entfällt to done/pending/neutral", () => {
    expect(ABNAHME_STATUS_TONE).toEqual({ Erfüllt: "done", Offen: "pending", Entfällt: "neutral" });
  });
});
