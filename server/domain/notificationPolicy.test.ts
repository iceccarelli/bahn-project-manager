import { describe, expect, it } from "vitest";
import { planNotification } from "./notificationPolicy";
import { event } from "../../client/src/realtime/testUtils";

const p = { id: 481, projektnummer: "G.992031294", station: "Koblenz Hbf" };
const plan = (changes: Record<string, { from: string | null; to: string | null }>, over = {}) => planNotification(event(481, 2, changes, over), p);

describe("notification policy", () => {
  it("projektstand → workflow; stopped/rejected → critical", () => {
    expect(plan({ projektstand: { from: "EP", to: "AP" } })).toMatchObject({ kind: "workflow", title: "Koblenz Hbf: Projektstand: EP → AP", link: "/projects?projekt=481" });
    expect(plan({ projektstand: { from: "EP", to: "Gestoppt" } })?.kind).toBe("critical");
    expect(plan({ "review.ITK.status": { from: "offen", to: "abgelehnt" } })?.kind).toBe("critical");
    expect(plan({ "review.ITK.status": { from: "offen", to: "Zustimmung erteilt" } })?.kind).toBe("workflow");
  });
  it("assignment and deadline kinds", () => {
    expect(plan({ projektleiter: { from: null, to: "Neu" } })?.kind).toBe("assignment");
    expect(plan({ "review.EEA.prueferName": { from: "A", to: "B" } })?.kind).toBe("assignment");
    expect(plan({ terminProjektvorstellung: { from: null, to: "2026-05-01" } })?.kind).toBe("deadline");
  });
  it("the most severe kind wins when several fields change; the body lists them", () => {
    const n = plan({ projektleiter: { from: "A", to: "B" }, projektstand: { from: "EP", to: "Gestoppt" } })!;
    expect(n.kind).toBe("critical");
    expect(n.body).toContain("2 Änderungen");
  });
  it("noise does not notify (free text, region moves); deletes are critical", () => {
    expect(plan({ kommentar: { from: null, to: "x" } })).toBeNull();
    expect(plan({ bahnhofsmanagement: { from: "Frankfurt", to: "Kassel" } })).toBeNull();
    expect(plan({}, { eventType: "project.deleted" })?.kind).toBe("critical");
    expect(planNotification(event(1, 1, { station: { from: null, to: "x" } }, { eventType: "project.created" }), p)).toBeNull();
  });
});
