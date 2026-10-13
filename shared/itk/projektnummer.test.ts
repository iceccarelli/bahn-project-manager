import { describe, expect, it } from "vitest";
import { projektnummerRoot } from "./projektnummer";

describe("projektnummerRoot", () => {
  it("strips sub-numbers", () => {
    expect(projektnummerRoot("G.011500001.01.01")).toBe("G.011500001");
    expect(projektnummerRoot("G.11588825.01.022")).toBe("G.11588825");
    expect(projektnummerRoot("G.011547155.02.02.01")).toBe("G.011547155");
  });
  it("keeps roots and other forms as they are", () => {
    expect(projektnummerRoot("G.011581600")).toBe("G.011581600");
    expect(projektnummerRoot("3T190511")).toBe("3T190511");
  });
  it("is null for nothing", () => {
    expect(projektnummerRoot(null)).toBeNull();
    expect(projektnummerRoot("  ")).toBeNull();
  });
});
