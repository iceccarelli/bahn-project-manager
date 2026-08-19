import { describe, expect, it } from "vitest";
import {
  CHECKLIST_BY_KEY,
  CHECKLIST_QUESTIONS,
  DEPARTMENT_QUESTIONS,
  UNTERSCHRIFTENBLATT,
  buildDepartmentReviews,
  defaultAnswers,
  isDepartmentRequired,
  notifiedRoles,
  visibleQuestions,
  type ChecklistAnswers,
} from "./checklist";
import { DEPARTMENTS } from "./validation";

describe("checklist structure", () => {
  it("has the 22 numbered entries from Formular rows 13-34", () => {
    expect(CHECKLIST_QUESTIONS).toHaveLength(22);
    expect(CHECKLIST_QUESTIONS.map((q) => q.formularRow)).toEqual(
      Array.from({ length: 22 }, (_, i) => 13 + i),
    );
  });

  it("skips Nr. 6, exactly as the workbook does", () => {
    const nrs = CHECKLIST_QUESTIONS.map((q) => q.nr);
    expect(nrs).toEqual([1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
    expect(nrs).not.toContain(6);
  });

  it("has unique keys and a lookup that covers every question", () => {
    const keys = CHECKLIST_QUESTIONS.map((q) => q.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(Object.keys(CHECKLIST_BY_KEY)).toHaveLength(22);
  });

  it("maps 1:1 onto the 14 DEPARTMENTS — no gaps, no duplicates", () => {
    const mapped = DEPARTMENT_QUESTIONS.map((q) => q.department);
    expect(mapped).toHaveLength(14);
    expect(new Set(mapped).size).toBe(14);
    expect([...mapped].sort()).toEqual([...DEPARTMENTS].sort());
  });

  it("maps Brandschutz to BS, not to a new department", () => {
    // BS's busiest reviewers in data.json are Afteni (506) and Fey (449), the
    // Brandschutz specialists in Hilfsdatei rows 6-7.
    expect(CHECKLIST_BY_KEY.brandschutz?.department).toBe("BS");
  });

  it("treats HuBs, ITK-FM and Bahnhofsmanagement as notification-only", () => {
    for (const key of ["hubs", "itkFm", "bahnhofsmanagement"]) {
      expect(CHECKLIST_BY_KEY[key]?.department).toBeNull();
      expect(CHECKLIST_BY_KEY[key]?.kind).toBe("gewerk");
    }
  });

  it("gives a secondary Ja/Nein to exactly rows 17, 18 and 19", () => {
    const withSecondary = CHECKLIST_QUESTIONS.filter((q) => q.secondary);
    expect(withSecondary.map((q) => q.formularRow)).toEqual([17, 18, 19]);
    expect(withSecondary.map((q) => q.key)).toEqual(["itk", "eea", "brandschutz"]);
  });
});

describe("modes", () => {
  it("hides the three FM rows in Projektanmeldung and shows them in Projektkonfiguration", () => {
    const anmeldung = visibleQuestions("Projektanmeldung").map((q) => q.key);
    const konfig = visibleQuestions("Projektkonfiguration").map((q) => q.key);
    for (const key of ["bahnhofsmanagement", "hubs", "itkFm"]) {
      expect(anmeldung).not.toContain(key);
      expect(konfig).toContain(key);
    }
  });

  it("hides pkpLink, unterschriftenblatt, mitProjektvorstellung and baubetriebsplanung in Projektkonfiguration", () => {
    const konfig = visibleQuestions("Projektkonfiguration").map((q) => q.key);
    for (const key of ["pkpLink", "unterschriftenblatt", "mitProjektvorstellung", "baubetriebsplanung"]) {
      expect(konfig).not.toContain(key);
    }
  });

  it("defaults every Gewerk to Nein in Projektanmeldung", () => {
    const a = defaultAnswers("Projektanmeldung");
    for (const q of CHECKLIST_QUESTIONS.filter((x) => x.kind === "gewerk")) {
      expect(a[q.key]?.answer).toBe("Nein");
    }
  });

  it("forces every Gewerk to Ja in Projektkonfiguration except Baubetriebsplanung", () => {
    const a = defaultAnswers("Projektkonfiguration");
    for (const q of CHECKLIST_QUESTIONS.filter((x) => x.kind === "gewerk")) {
      expect(a[q.key]?.answer).toBe(q.key === "baubetriebsplanung" ? "Nein" : "Ja");
    }
  });
});

describe("trigger rule", () => {
  const base = (): ChecklistAnswers => defaultAnswers("Projektanmeldung");
  const q = (key: string) => {
    const question = CHECKLIST_BY_KEY[key];
    if (!question) throw new Error(`no checklist question ${key}`);
    return question;
  };

  it("requires a department when the primary answer is Ja", () => {
    const a = base();
    a.foerdertechnik = { answer: "Ja" };
    expect(isDepartmentRequired(q("foerdertechnik"), a)).toBe(true);
  });

  it("requires a department when only the secondary answer is Ja", () => {
    // VBA: If Range("F17") = "Ja" Or Range("H17") = "Ja" Then
    const a = base();
    a.itk = { answer: "Nein", secondary: "Ja" };
    expect(isDepartmentRequired(q("itk"), a)).toBe(true);
  });

  it("ignores a secondary answer on a row that has no secondary question", () => {
    const a = base();
    a.foerdertechnik = { answer: "Nein", secondary: "Ja" };
    expect(isDepartmentRequired(q("foerdertechnik"), a)).toBe(false);
  });
});

describe("buildDepartmentReviews", () => {
  it("always returns all 14 rows, matching how data.json is shaped", () => {
    const reviews = buildDepartmentReviews(defaultAnswers("Projektanmeldung"));
    expect(reviews).toHaveLength(14);
    expect(reviews.every((r) => r.status === "nicht erforderlich")).toBe(true);
  });

  it("opens exactly the departments the checklist requires", () => {
    const a = defaultAnswers("Projektanmeldung");
    a.itk = { answer: "Ja" };
    a.tbq = { answer: "Ja" };
    a.eea = { answer: "Nein", secondary: "Ja" };
    const reviews = buildDepartmentReviews(a);
    const open = reviews.filter((r) => r.status === "offen").map((r) => r.department);
    expect([...open].sort()).toEqual(["EEA", "ITK", "TBQ"]);
    expect(reviews.filter((r) => r.status === "nicht erforderlich")).toHaveLength(11);
  });

  it("records which answer decided each review", () => {
    const a = defaultAnswers("Projektanmeldung");
    a.eea = { answer: "Nein", secondary: "Ja" };
    const eea = buildDepartmentReviews(a).find((r) => r.department === "EEA");
    expect(eea?.decidedBy).toBe("eea");
    expect(eea?.viaSecondary).toBe(true);
  });

  it("opens 13 of 14 in Projektkonfiguration — Baubetriebsplanung stays closed", () => {
    const reviews = buildDepartmentReviews(defaultAnswers("Projektkonfiguration"));
    const closed = reviews.filter((r) => r.status === "nicht erforderlich");
    expect(closed).toHaveLength(1);
    expect(closed[0]?.department).toBe("Baubetriebsplanung");
  });
});

describe("notifiedRoles", () => {
  it("returns the non-review recipients a Projektkonfiguration triggers", () => {
    expect([...notifiedRoles(defaultAnswers("Projektkonfiguration"))].sort()).toEqual([
      "bahnhofsmanagement",
      "hubs",
      "itkFm",
    ]);
  });

  it("returns none for a default Projektanmeldung", () => {
    expect(notifiedRoles(defaultAnswers("Projektanmeldung"))).toEqual([]);
  });
});

describe("Unterschriftenblatt", () => {
  it("has the 19 signature blocks from Checkliste rows 15-89", () => {
    expect(UNTERSCHRIFTENBLATT).toHaveLength(19);
  });

  it("references only real departments", () => {
    for (const block of UNTERSCHRIFTENBLATT) {
      if (block.department) expect(DEPARTMENTS).toContain(block.department);
    }
  });

  it("covers 12 of the 14 departments — Baubetrieb has no block on the sheet", () => {
    const covered = UNTERSCHRIFTENBLATT.map((b) => b.department).filter(Boolean);
    expect(new Set(covered).size).toBe(12);
    expect(covered).not.toContain("Baubetriebstechnologie");
    expect(covered).not.toContain("Baubetriebsplanung");
  });
});
