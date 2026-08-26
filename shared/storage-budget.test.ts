import { describe, it, expect } from "vitest";
import {
  BUDGET_CRITICAL,
  BUDGET_TIGHT,
  LOCAL_STORAGE_CAP_BYTES,
  formatBytes,
  storageBudget,
} from "./storage-budget";

const MB = 1024 * 1024;

describe("the budget for the only place changes are kept", () => {
  it("is measured against the browser cap, not against a disk estimate", () => {
    // navigator.storage.estimate() reported 519 MB in this app for a store
    // that holds 5. A budget built on that reads 0.4 % full at the moment the
    // next write throws.
    expect(LOCAL_STORAGE_CAP_BYTES).toBe(5 * MB);
  });

  it("reports the shipped store as it was measured: 2,15 MB, about 43 %", () => {
    const b = storageBudget({ bahn_projects_v3: 2_255_872, theme: 5, "bahn-demo-user": 120 });
    expect(b.share).toBeGreaterThan(40);
    expect(b.share).toBeLessThan(45);
    expect(b.level).toBe("ok");
    expect(formatBytes(b.usedBytes)).toBe("2,2 MB");
  });

  it("names what is taking the room, largest first", () => {
    const b = storageBudget({ small: 10, huge: 3_000_000, middle: 50_000 });
    expect(b.biggest.map((x) => x.key)).toEqual(["huge", "middle", "small"]);
  });

  it("warns before the cap, not at it", () => {
    const tight = storageBudget({ x: Math.round(LOCAL_STORAGE_CAP_BYTES * 0.75) });
    expect(tight.share).toBeGreaterThanOrEqual(BUDGET_TIGHT);
    expect(tight.level).toBe("eng");

    const critical = storageBudget({ x: Math.round(LOCAL_STORAGE_CAP_BYTES * 0.95) });
    expect(critical.share).toBeGreaterThanOrEqual(BUDGET_CRITICAL);
    expect(critical.level).toBe("kritisch");
  });

  it("never reports negative room left", () => {
    const over = storageBudget({ x: 9 * MB });
    expect(over.freeBytes).toBe(0);
    expect(over.level).toBe("kritisch");
  });

  it("treats an unmeasurable store as empty rather than as full", () => {
    const none = storageBudget({});
    expect(none.usedBytes).toBe(0);
    expect(none.level).toBe("ok");
  });

  it("prints German units a reader can compare", () => {
    expect(formatBytes(0)).toBe("0 kB");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(2048)).toBe("2 kB");
    expect(formatBytes(5 * MB)).toBe("5,0 MB");
  });
});
