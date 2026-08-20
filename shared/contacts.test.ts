import { describe, expect, it } from "vitest";
import { DEPARTMENTS } from "./types";
import {
  CONTACTS,
  DEPARTMENT_RECIPIENT_ROWS,
  VBA_RECIPIENT_ROWS,
  bahnhofsmanagementContact,
  departmentsWithoutRecipients,
  mailListFor,
  notifyOnlyRecipients,
  displayName,
  recipientsFor,
} from "./contacts";
import { BAHNHOFSMANAGEMENT } from "./bahnhofsmanagement";

describe("contacts", () => {
  it("transcribes every Hilfsdatei row that carries an address", () => {
    expect(CONTACTS).toHaveLength(51);
    for (const c of CONTACTS) {
      expect(c.mail, `row ${c.row}`).toMatch(/@deutschebahn\.com$/i);
      expect(c.row).toBeGreaterThan(0);
    }
  });

  it("covers all 14 departments", () => {
    for (const d of DEPARTMENTS) {
      expect(DEPARTMENT_RECIPIENT_ROWS[d], `no rows for ${d}`).toBeDefined();
    }
    expect(Object.keys(DEPARTMENT_RECIPIENT_ROWS)).toHaveLength(DEPARTMENTS.length);
  });

  // ---- the off-by-two ------------------------------------------------------

  it("fixes ITK: rows 10-14, not the macro's 8-12", () => {
    expect(DEPARTMENT_RECIPIENT_ROWS.ITK).toEqual([10, 11, 12, 13, 14]);
    expect(VBA_RECIPIENT_ROWS[17]).toEqual([8, 9, 10, 11, 12]);
  });

  it("no longer mails a Brandschutz specialist about an ITK review", () => {
    const itk = recipientsFor("ITK");
    const gorissen = CONTACTS.find((c) => c.row === 8);
    expect(gorissen?.group).toBe("Brandschutz");
    expect(itk.map((c) => c.row)).not.toContain(8);
    expect(itk.every((c) => c.group.includes("Telekommunikation"))).toBe(true);
  });

  it("now reaches Emin Er and Daniel Goldhausen", () => {
    // Er holds 471 of the 510 ITK reviews and had never been notified.
    const mails = recipientsFor("ITK").map((c) => c.mail.toLowerCase());
    expect(mails).toContain("emin.er@deutschebahn.com");
    expect(mails).toContain("daniel.goldhausen@deutschebahn.com");
  });

  it("changes nothing except ITK", () => {
    // Guards against an accidental re-shuffle while fixing the one range.
    const FORMULAR_BY_DEPT: Record<string, number> = {
      ITK: 17, EEA: 18, BS: 19, HFT: 20, HKLS: 21, GA: 22, Energie: 23,
      TBQ: 24, UM: 25, BIM: 29, LST: 30, Vermessung: 31,
      Baubetriebstechnologie: 32, Baubetriebsplanung: 33,
    };
    for (const [dept, formularRow] of Object.entries(FORMULAR_BY_DEPT)) {
      const ours = DEPARTMENT_RECIPIENT_ROWS[dept as keyof typeof DEPARTMENT_RECIPIENT_ROWS];
      const theirs = VBA_RECIPIENT_ROWS[formularRow];
      if (dept === "ITK") expect(ours).not.toEqual(theirs);
      else expect(ours, `${dept} should be unchanged`).toEqual(theirs);
    }
  });

  // ---- missing data, surfaced rather than swallowed -------------------------

  it("never emits a blank recipient", () => {
    for (const d of DEPARTMENTS) {
      for (const c of recipientsFor(d)) {
        expect(c.mail.trim(), `blank address for ${d}`).not.toBe("");
      }
    }
  });

  it("names LST as reaching nobody instead of pretending it sent", () => {
    // Rows 74 and 75 carry the group label "LST" and no address. 52 reviews,
    // 22 of them open, and the notification has never reached a person.
    expect(departmentsWithoutRecipients()).toEqual(["LST"]);
    expect(recipientsFor("LST")).toEqual([]);
  });

  it("keeps blank rows in the range so a later fill-in needs no code change", () => {
    expect(DEPARTMENT_RECIPIENT_ROWS.Vermessung).toContain(72);
    expect(recipientsFor("Vermessung")).toHaveLength(1);
  });

  // ---- notify-only groups --------------------------------------------------

  it("has a contact for every Bahnhofsmanagement except übergreifend", () => {
    const missing = BAHNHOFSMANAGEMENT.filter(
      (bm) => bm !== "übergreifend" && !bahnhofsmanagementContact(bm),
    );
    expect(missing).toEqual([]);
    // "übergreifend" is a scope, not a place, and has no single owner.
    expect(bahnhofsmanagementContact("übergreifend")).toBeNull();
  });

  it("resolves a BM contact case-insensitively and tolerates null", () => {
    expect(bahnhofsmanagementContact("frankfurt")?.name).toBe("Melanie Kühner");
    expect(bahnhofsmanagementContact(null)).toBeNull();
    expect(bahnhofsmanagementContact("  Mainz ")?.name).toBe("Andre Schulte");
  });

  it("carries the HuBs and ITK-FM notify-only recipients", () => {
    expect(notifyOnlyRecipients("huBs").map((c) => c.name)).toEqual(["Luigi La Rocca"]);
    expect(notifyOnlyRecipients("itkFm").length).toBeGreaterThanOrEqual(3);
  });

  // ---- list building -------------------------------------------------------

  it("de-duplicates across departments", () => {
    const list = mailListFor(["ITK", "ITK", "BS"]);
    expect(new Set(list).size).toBe(list.length);
    expect(list.length).toBe(recipientsFor("ITK").length + recipientsFor("BS").length);
  });

  it("returns an empty list, not a list of empties, for LST", () => {
    expect(mailListFor(["LST"])).toEqual([]);
  });
});

describe("displayName", () => {
  it("falls back to the address for the nameless ITK shared mailbox", () => {
    const mailbox = CONTACTS.find((c) => c.row === 10);
    expect(mailbox?.name).toBe("");
    expect(displayName(mailbox as never)).toBe(mailbox?.mail);
  });

  it("prefers the name when there is one", () => {
    const er = CONTACTS.find((c) => c.mail.toLowerCase() === "emin.er@deutschebahn.com");
    expect(displayName(er as never)).toBe("Emin Er");
  });
});
