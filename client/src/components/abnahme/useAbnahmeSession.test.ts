import { describe, expect, it } from "vitest";
import { storageKey } from "./useAbnahmeSession";

describe("storageKey", () => {
  it("separates Technik and project so ids shared across Techniken cannot collide", () => {
    expect(storageKey("ZIM", null)).toBe("abnahme:v1:ZIM:frei");
    expect(storageKey("Video", 12)).toBe("abnahme:v1:Video:12");
    expect(storageKey("ZIM", 12)).not.toBe(storageKey("Video", 12));
  });
});
