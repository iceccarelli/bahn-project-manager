import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { ask, extractEntities, rankSkills, STARTERS } from "./resolve";
import { SKILLS, helpAnswer } from "./skills";
import {
  ASK,
  ASK_INTENT,
  contactAsk,
  gewerkAsk,
  MAX_FOLLOW_UPS,
  stationAsk,
} from "./follow-ups";
import { DEPARTMENT_LIST } from "../validation";
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

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------
//
// A chip is a promise. These tests are the only thing standing between a
// well-phrased suggestion and a reader clicking it to be told "das habe ich
// nicht verstanden" — which, once, teaches them the panel is decorative. So
// every question the assistant offers itself is sent straight back through the
// resolver, over the real data.json, and has to come back measured.

describe("every answer leads somewhere", () => {
  const ENTITIES = {
    department: "ITK",
    station: "Bensheim",
    projektnummer: "G.011540063",
  };

  it("offers at least two next questions on every skill", () => {
    for (const skill of SKILLS) {
      const a = skill.run(CTX, ENTITIES);
      expect(a.followUps.length, skill.id).toBeGreaterThanOrEqual(2);
      expect(a.followUps.length, skill.id).toBeLessThanOrEqual(MAX_FOLLOW_UPS);
    }
  });

  it("offers at least two next questions when it did not understand", () => {
    expect(helpAnswer().followUps.length).toBeGreaterThanOrEqual(2);
    expect(ask("qwertz asdfgh", CTX).followUps.length).toBeGreaterThanOrEqual(2);
  });

  it("never offers a question it cannot answer", () => {
    for (const skill of SKILLS) {
      for (const f of skill.run(CTX, ENTITIES).followUps) {
        const next = ask(f.question, CTX);
        expect(next.confidence, `${skill.id} → ${f.question}`).toBe("measured");
      }
    }
  });

  it("never offers the question that was just answered", () => {
    for (const skill of SKILLS) {
      const a = skill.run(CTX, ENTITIES);
      for (const f of a.followUps) {
        expect(ask(f.question, CTX).intent, `${skill.id} → ${f.question}`).not.toBe(skill.id);
      }
    }
  });

  it("never offers the same question twice in one row", () => {
    for (const skill of SKILLS) {
      const questions = skill.run(CTX, ENTITIES).followUps.map((f) => f.question);
      expect(new Set(questions).size, skill.id).toBe(questions.length);
    }
  });

  it("routes each catalogue question to the skill it was written for", () => {
    for (const [key, followUp] of Object.entries(ASK)) {
      const a = ask(followUp.question, CTX);
      expect(a.intent, followUp.question).toBe(ASK_INTENT[key as keyof typeof ASK]);
      expect(a.confidence, followUp.question).toBe("measured");
    }
  });

  it("builds a Gewerk question that lands on that Gewerk, for all fourteen", () => {
    for (const department of DEPARTMENT_LIST) {
      const a = ask(gewerkAsk(department).question, CTX);
      expect(a.intent, department).toBe("gewerk-status");
      expect(a.confidence, department).toBe("measured");
      expect(a.headline, department).toContain(department);
    }
  });

  it("builds a station question that lands on that station", () => {
    // Every station in the file, not a sample: a station name is data, and the
    // one that breaks the phrasing will be the one nobody thought to try.
    const stations = [
      ...new Set(
        (CTX.projects as ReadonlyArray<{ station?: string | null }>)
          .map((p) => (p.station ?? "").trim())
          .filter(Boolean),
      ),
    ];
    expect(stations.length).toBeGreaterThan(50);
    for (const station of stations) {
      const followUp = stationAsk(station);
      if (!followUp) continue;
      const a = ask(followUp.question, CTX);
      expect(a.intent, station).toBe("station");
      expect(a.confidence, station).toBe("measured");
    }
  });

  it("never offers a contact question for a Gewerk with no address on file", () => {
    // LST is the live case: Hilfsdatei rows 74 and 75 are both empty, so there
    // is nobody to name and the assistant must not pretend otherwise.
    expect(contactAsk("LST")).toBeNull();
    for (const department of DEPARTMENT_LIST) {
      const followUp = contactAsk(department);
      if (followUp === null) continue;
      const a = ask(followUp.question, CTX);
      expect(a.intent, department).toBe("contact");
      expect(a.facts.length, department).toBeGreaterThan(0);
    }
  });

  it("stays answerable two clicks deep from every starter", () => {
    for (const starter of STARTERS) {
      const first = ask(starter.question, CTX);
      expect(first.confidence, starter.question).toBe("measured");
      for (const f of first.followUps) {
        const second = ask(f.question, CTX);
        expect(second.confidence, `${starter.question} → ${f.question}`).toBe("measured");
        for (const g of second.followUps) {
          expect(
            ask(g.question, CTX).confidence,
            `${starter.question} → ${f.question} → ${g.question}`,
          ).toBe("measured");
        }
      }
    }
  });
});
