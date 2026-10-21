import { describe, expect, it } from "vitest";
import { NAV_ITEMS, activeNavId, isActivePath, moreIsActive, moreItems, phoneBarItems } from "./navModel";

describe("navigation model", () => {
  it("has unique ids and unique absolute paths", () => {
    expect(new Set(NAV_ITEMS.map(i => i.id)).size).toBe(NAV_ITEMS.length);
    expect(new Set(NAV_ITEMS.map(i => i.path)).size).toBe(NAV_ITEMS.length);
    for (const i of NAV_ITEMS) expect(i.path.startsWith("/")).toBe(true);
  });
  it("the phone shows exactly four destinations plus 'Mehr' (five thumb targets), the centre one being the Anmeldung action", () => {
    const bar = phoneBarItems();
    expect(bar.map(i => i.id)).toEqual(["start", "projekte", "anmeldung", "aktivitaet"]);
    expect(bar[2]?.phone).toBe("action");
    expect(bar.length + 1).toBe(5);
  });
  it("every destination is reachable on a phone: either in the bar or behind 'Mehr' — none lost, none twice", () => {
    const ids = [...phoneBarItems(), ...moreItems()].map(i => i.id).sort();
    expect(ids).toEqual(NAV_ITEMS.map(i => i.id).sort());
  });
  it("the specialist pages and the account page sit behind 'Mehr'", () => {
    expect(moreItems().map(i => i.id)).toEqual(["bvb-eea", "psv-itk", "einstellungen"]);
  });
  it("short labels fit five equal tabs", () => {
    for (const i of phoneBarItems()) expect(i.shortLabel.length).toBeLessThanOrEqual(9);
  });
});

describe("isActivePath", () => {
  it("is segment-aware and ignores query and hash", () => {
    expect(isActivePath("/projects", "/projects")).toBe(true);
    expect(isActivePath("/projects?detail=481", "/projects")).toBe(true);
    expect(isActivePath("/projects#x", "/projects")).toBe(true);
    expect(isActivePath("/projects/481", "/projects")).toBe(true);
    expect(isActivePath("/projects-old", "/projects")).toBe(false);
    expect(isActivePath("/bvb-eea", "/psv-itk")).toBe(false);
  });
  it("the dashboard is active only at the root", () => {
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath("/?x=1", "/")).toBe(true);
    expect(isActivePath("/projects", "/")).toBe(false);
  });
  it("activeNavId and moreIsActive agree", () => {
    expect(activeNavId("/psv-itk")).toBe("psv-itk");
    expect(activeNavId("/nope")).toBeNull();
    expect(moreIsActive("/einstellungen")).toBe(true);
    expect(moreIsActive("/audit")).toBe(false);
    expect(moreIsActive("/")).toBe(false);
  });
});
