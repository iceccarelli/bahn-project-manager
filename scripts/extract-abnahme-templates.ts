/**
 * scripts/extract-abnahme-templates.ts
 * ---------------------------------------------------------------------------
 * Turns the Abnahme prototype's checklist data into the typed template modules
 * under shared/abnahme/templates/, in two steps that mirror stations:extract /
 * stations:generate:
 *
 *   1. node --import tsx scripts/extract-abnahme-templates.ts --from <abnahme-verlauf-itk dir>
 *        reads <dir>/data/AbnahmeData{,_Video,_DSA+,_dBOS}.js, validates them and
 *        writes data/abnahme-source.json — the tracked, reviewable source of
 *        record (verbatim: no renaming, no reordering).
 *
 *   2. node --import tsx scripts/extract-abnahme-templates.ts
 *        reads data/abnahme-source.json and regenerates the .ts modules.
 *        `--check` fails instead of writing when a module is out of date.
 *
 * Sections that are byte-identical in several Techniken (1.1 in all four, 1.2–1.6
 * in ZIM and dBOS) are emitted once into templates/common.ts and referenced, so
 * a correction cannot reach one Technik and miss another.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "data", "abnahme-source.json");
const OUT_DIR = path.join(ROOT, "shared", "abnahme", "templates");

interface RawItem { id: string; label: string; selected: null; mangel: string }
interface RawSection { title: string; items: RawItem[] }
type RawSource = Record<string, RawSection[]>;

/** Technik → prototype data file, and the generated module it becomes. */
const TECHNIKEN = [
  { technik: "ZIM", file: "AbnahmeData.js", module: "zim", constant: "ZIM_TEMPLATE" },
  { technik: "Video", file: "AbnahmeData_Video.js", module: "video", constant: "VIDEO_TEMPLATE" },
  { technik: "DSA+", file: "AbnahmeData_DSA+.js", module: "dsa-plus", constant: "DSA_PLUS_TEMPLATE" },
  { technik: "dBOS", file: "AbnahmeData_dBOS.js", module: "dbos", constant: "DBOS_TEMPLATE" },
] as const;

const args = process.argv.slice(2);
const check = args.includes("--check");
const fromIdx = args.indexOf("--from");

function fail(message: string): never {
  console.error(`extract-abnahme-templates: ${message}`);
  process.exit(1);
}

function validate(technik: string, sections: RawSection[]): void {
  const ids = new Set<string>();
  for (const section of sections) {
    if (!section.title || !Array.isArray(section.items) || section.items.length === 0) {
      fail(`${technik}: section without title or items`);
    }
    for (const item of section.items) {
      if (!item.id || !item.label) fail(`${technik}: item without id or label in "${section.title}"`);
      if (item.selected !== null || item.mangel !== "") fail(`${technik}: ${item.id} carries an answer`);
      if (ids.has(item.id)) fail(`${technik}: duplicate item id ${item.id}`);
      ids.add(item.id);
    }
  }
}

if (fromIdx !== -1) {
  const dir = args[fromIdx + 1];
  if (!dir) fail("--from needs the abnahme-verlauf-itk directory");
  const require = createRequire(import.meta.url);
  const source: RawSource = {};
  for (const { technik, file } of TECHNIKEN) {
    const loaded = require(path.resolve(dir, "data", file)) as { initialChecklistSections: RawSection[] };
    const sections = loaded.initialChecklistSections;
    validate(technik, sections);
    source[technik] = sections.map((s) => ({
      title: s.title,
      items: s.items.map((i) => ({ id: i.id, label: i.label, selected: null, mangel: "" })),
    }));
  }
  fs.writeFileSync(SOURCE, `${JSON.stringify(source, null, 2)}\n`);
  console.log(`wrote ${path.relative(ROOT, SOURCE)}`);
}

const source = JSON.parse(fs.readFileSync(SOURCE, "utf8")) as RawSource;

/** "1.2 Prüfkriterien X" → ["1.2", "Prüfkriterien X"]; "2. Optische …" → ["2", "Optische …"]. */
function splitTitle(title: string): { number: string; title: string } {
  const m = /^(\d+(?:\.\d+)*)\.?\s+(.+)$/.exec(title);
  if (!m?.[1] || !m[2]) fail(`cannot split section title "${title}"`);
  return { number: m[1], title: m[2] };
}

interface Section { number: string; title: string; items: { id: string; label: string }[] }

const parsed = new Map<string, Section[]>();
for (const { technik } of TECHNIKEN) {
  const raw = source[technik];
  if (!raw) fail(`data/abnahme-source.json has no ${technik}`);
  validate(technik, raw);
  parsed.set(
    technik,
    raw.map((s) => ({ ...splitTitle(s.title), items: s.items.map(({ id, label }) => ({ id, label })) })),
  );
}

const fingerprint = (s: Section) => JSON.stringify(s);
const uses = new Map<string, number>();
for (const sections of parsed.values()) for (const s of sections) uses.set(fingerprint(s), (uses.get(fingerprint(s)) ?? 0) + 1);

const commonName = (s: Section) => `SECTION_${s.number.replace(/\./g, "_")}`;
const commonSections = new Map<string, Section>();
for (const sections of parsed.values()) {
  for (const s of sections) if ((uses.get(fingerprint(s)) ?? 0) > 1) commonSections.set(fingerprint(s), s);
}
// A common number must map to one fingerprint, otherwise two different texts would share a constant name.
const byName = new Map<string, string>();
for (const [fp, s] of commonSections) {
  const prior = byName.get(commonName(s));
  if (prior && prior !== fp) fail(`two different common sections numbered ${s.number}`);
  byName.set(commonName(s), fp);
}

const HEADER = "// GENERATED by scripts/extract-abnahme-templates.ts from data/abnahme-source.json — do not edit by hand.\n";
const literal = (value: unknown, indent: number) => JSON.stringify(value, null, 2).replace(/\n/g, `\n${" ".repeat(indent)}`);

const files = new Map<string, string>();

files.set(
  "common.ts",
  `${HEADER}import type { ChecklistSection } from "../types";\n\n${[...commonSections.values()]
      .map((s) => `/** Identical in ${[...parsed].filter(([, secs]) => secs.some((x) => fingerprint(x) === fingerprint(s))).map(([t]) => t).join(", ")}. */\nexport const ${commonName(s)}: ChecklistSection = ${literal(s, 0)};\n`)
      .join("\n")}`,
);

for (const { technik, module, constant } of TECHNIKEN) {
  const sections = parsed.get(technik) ?? [];
  const used = sections.filter((s) => commonSections.has(fingerprint(s))).map(commonName);
  const body = sections
    .map((s) => (commonSections.has(fingerprint(s)) ? `    ${commonName(s)},` : `    ${literal(s, 4)},`))
    .join("\n");
  files.set(
    `${module}.ts`,
    `${HEADER}import type { ChecklistTemplate } from "../types";\n${used.length ? `import { ${used.join(", ")} } from "./common";\n` : ""}\nexport const ${constant}: ChecklistTemplate = {\n  technik: ${JSON.stringify(technik)},\n  version: "1",\n  sections: [\n${body}\n  ],\n};\n`,
  );
}

let stale = false;
for (const [name, content] of files) {
  const target = path.join(OUT_DIR, name);
  if (check) {
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== content) {
      console.error(`stale: shared/abnahme/templates/${name}`);
      stale = true;
    }
  } else {
    fs.writeFileSync(target, content);
    console.log(`wrote shared/abnahme/templates/${name}`);
  }
}
if (stale) process.exit(1);
