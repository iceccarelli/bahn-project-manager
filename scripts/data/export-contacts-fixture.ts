/** Writes fixtures/synthetic/contacts.source.json from shared/contacts.ts (the synthetic directory the e2e suite checks mail addresses against). */
import { writeFileSync } from "node:fs";
import { CONTACTS } from "../../shared/contacts";

writeFileSync("fixtures/synthetic/contacts.source.json", `${JSON.stringify(CONTACTS.map(c => ({ row: c.row, group: c.group, name: c.name, mail: c.mail })), null, 2)}\n`);
console.log(`[data] wrote ${CONTACTS.length} contacts`);
