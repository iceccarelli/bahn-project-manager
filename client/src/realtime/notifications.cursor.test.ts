import { describe, expect, it } from "vitest";
import { nextCursorOf } from "./notifications";

describe("bell paging cursor", () => {
  it("uses the first page's cursor until an older page was loaded, then only that page's — null means exhausted, never a fallback", () => {
    expect(nextCursorOf({ loaded: false, nextCursor: null }, 120)).toBe(120);
    expect(nextCursorOf({ loaded: true, nextCursor: 80 }, 120)).toBe(80);
    expect(nextCursorOf({ loaded: true, nextCursor: null }, 120)).toBeNull();
    expect(nextCursorOf({ loaded: false, nextCursor: null }, null)).toBeNull();
  });
});
