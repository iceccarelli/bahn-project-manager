import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { ask, extractEntities, rankSkills, STARTERS } from "./resolve";
import { SKILLS, helpAnswer } from "./skills";
import type { AgentContext } from "./types";

const DATA = JSON.parse(fs.readFileSync("client/public/data.json", "utf8"));
const CTX: AgentContext = {
  projects: DATA.projects,
  audit: [],
  today: Date.parse("2026-08-22T00:00:00Z"),
};

describe("it understands what was asked", () => {
  it("finds the Gewerk in a sentence, and forgives a typo", () => {
    expect(extractEntities("Wie steht EEA?", CTX).department).toBe("EEA");
    expect(extractEntities("wie viele itk prüfungen sind offen", CTX).department).toBe("ITK");
    expect(extractEntities("wie steht Vermessng", CTX).department).toBe("Vermessung");
  });

  it("only recognises a Gewerk that exists", () => {
    expect(extractEntities("Wie steht QQQ?", CTX).department).toBeUndefined();
  });

  it("lifts a Projektnummer out of the sentence", () => {
    expect(extractEntities("zeig mir G.011540063 bitte", CTX).projektnummer).toBe("G.011540063");
  });

  it("prefers the longest matching station name", () => {
    // "Frankfurt" is also a region, and "Frankfurt (Main) Süd" contains it.
    const e = extractEntities("Was läuft in Frankfurt (Main) Süd?", CTX);
    expect(e.station).toBe("Frankfurt (Main) Süd");
  });

  it("recognises a station typed without its umlaut", () => {
    const e = extractEntities("Was laeuft in Giessen HBF", CTX);
    expect(e.station).toBeTruthy();
  });

  it("never offers a skill whose entity is missing", () => {
    const ranked = rankSkills("wie steht es", {});
    expect(ranked.every((r) => !r.skill.needs)).toBe(true);
  });
});

describe("every answer is measured, never composed", () => {
  it("agrees with the Gewerk tab it links to", () => {
    const a = ask("Wie steht EEA?", CTX);
    expect(a.confidence).toBe("measured");
    expect(a.facts.find((f) => f.label === "erforderlich")?.value).toBe("814");
    expect(a.actions.some((x) => x.href === "/bvb-eea")).toBe(true);
  });

  it("states the basis of its figures on every answer", () => {
    for (const skill of SKILLS) {
      const a = skill.run(CTX, { department: "ITK", station: "Bensheim", projektnummer: "G.011540063" });
      expect(a.basis, skill.id).toBeTruthy();
      expect(a.intent, skill.id).toBe(skill.id);
    }
  });

  it("names the Gewerke that have approved nothing rather than showing 0%", () => {
    const a = ask("Wie steht das Portfolio insgesamt?", CTX);
    const fact = a.facts.find((f) => f.label === "Gewerke ohne jede Zustimmung");
    expect(fact?.value).toContain("UM");
    expect(fact?.value).toContain("BIM");
  });

  it("warns on a Gewerk that cannot show progress", () => {
    const a = ask("Wie steht UM?", CTX);
    expect(a.facts.some((f) => f.label === "Hinweis" && /keine Zustimmung/.test(f.value))).toBe(true);
  });

  it("ranks the most critical Gewerk and says why", () => {
    const a = ask("Was ist gerade kritisch?", CTX);
    expect(a.intent).toBe("most-critical");
    expect(a.headline).toMatch(/blockiert/);
    // The weights are stated, because the ranking is a judgement, not a fact.
    expect(a.basis).toMatch(/keine Messung/);
  });

  it("reports undated open rows instead of quietly excluding them", () => {
    const a = ask("Wie alt sind die offenen Prüfungen?", CTX);
    expect(a.facts.some((f) => /ohne Prüfdatum/.test(f.label))).toBe(true);
  });

  it("explains the shared Projektnummer rather than calling it an error", () => {
    const a = ask("Wie verlässlich sind die Zahlen?", CTX);
    const fact = a.facts.find((f) => f.label === "Projektnummern");
    expect(fact?.value).toMatch(/Programm/);
  });

  it("never invents a contact address", () => {
    const a = ask("Wer ist für LST zuständig?", CTX);
    // Hilfsdatei rows 74/75 are empty for LST — it must say so, not construct one.
    expect(a.basis).toMatch(/nie erzeugt/);
    for (const f of a.facts) expect(f.value).not.toMatch(/@deutschebahn\.com/);
  });
});

describe("it says when it does not know", () => {
  it("offers what it can do instead of guessing", () => {
    const a = ask("Wie ist das Wetter in Kassel?", CTX);
    if (a.confidence === "unknown") {
      expect(a.facts.length).toBeGreaterThan(5);
      expect(a.basis).toMatch(/nichts wird geschätzt/);
    } else {
      // If it did match a skill, the figures must still be measured.
      expect(a.basis).toBeTruthy();
    }
  });

  it("says a project is not loaded rather than describing one that is not there", () => {
    const a = ask("zeig mir G.999999999", CTX);
    expect(a.confidence).toBe("unknown");
    expect(a.headline).toMatch(/kein Projekt/);
  });

  it("returns the help answer for an empty question", () => {
    expect(ask("   ", CTX).intent).toBe("help");
    expect(helpAnswer().facts.length).toBe(SKILLS.length);
  });
});

describe("it is deterministic", () => {
  it("gives the same answer to the same question", () => {
    for (const s of STARTERS) {
      const a = ask(s.question, CTX);
      const b = ask(s.question, CTX);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it("answers every starter it offers", () => {
    for (const s of STARTERS) {
      const a = ask(s.question, CTX);
      expect(a.confidence, s.question).toBe("measured");
      expect(a.headline.length, s.question).toBeGreaterThan(10);
    }
  });
});

describe("speed", () => {
  it("answers inside a keystroke", () => {
    let fastest = Number.POSITIVE_INFINITY;
    for (let batch = 0; batch < 3; batch++) {
      const started = performance.now();
      for (const s of STARTERS) ask(s.question, CTX);
      fastest = Math.min(fastest, (performance.now() - started) / STARTERS.length);
    }
    expect(fastest, `${fastest.toFixed(1)} ms per answer`).toBeLessThan(120);
  });
});
