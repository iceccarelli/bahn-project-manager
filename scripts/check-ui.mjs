/**
 * UI rendering audit.
 *
 * Four classes of defect, all measured in a real browser against the
 * production bundle rather than judged by eye:
 *
 *   1. SPILL      an element painting outside the content box of the nearest
 *                 ancestor that draws a background or a border — a badge over
 *                 the edge of its card, a label past the end of its tile.
 *   2. OVERLAP    two text-bearing elements whose boxes intersect, so one
 *                 string is painted on top of another.
 *   3. CONTRAST   rendered text colour against its effective background, by
 *                 WCAG 2.1 contrast ratio. 4.5:1 for body text, 3:1 for text
 *                 at 24px, or 18.66px and bold.
 *   4. SCALE      every distinct font-size, weight and family actually
 *                 rendered, so "consistent typography" is a measurement and
 *                 not an opinion.
 *
 * Run with `--inventory` to print 4 in full; by default it reports only the
 * sizes that fall outside the type scale.
 *
 *   pnpm build:client && pnpm check:ui
 */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "dist", "public");
const PORT = Number(process.env.UI_CHECK_PORT || 4910);
const MIME = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css",
  ".json":"application/json", ".woff2":"font/woff2", ".png":"image/png",
  ".svg":"image/svg+xml", ".ttf":"font/ttf" };

if (!fs.existsSync(path.join(ROOT, "index.html"))) {
  console.error("!! dist/public/index.html missing — run `pnpm build:client` first");
  process.exit(2);
}

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  let f = path.join(ROOT, u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(ROOT, "index.html");
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});

const SHOW_INVENTORY = process.argv.includes("--inventory");
const DEMO_USER = { id: 1, openId: "ui-check", name: "UI Check", email: "ui@db.de", role: "admin" };

/**
 * The type scale.
 *
 * Every size the app is allowed to render, in px, at the root 16px font size.
 * Anything else is an ad-hoc value that will drift, and the audit fails on it.
 */
const TYPE_SCALE = [11, 12, 14, 16, 18, 20, 24, 30, 36, 48, 60];

/** Colour tokens are HSL triples in index.css; here we only judge the result. */
const ROUTES = [
  { path: "/", name: "Dashboard" },
  { path: "/projects", name: "Projekte" },
  { path: "/bvb-eea", name: "BVB-EEA" },
  { path: "/psv-itk", name: "PSV-ITK" },
  { path: "/audit", name: "Änderungshistorie" },
  { path: "/anmeldung", name: "Projektanmeldung" },
];

const VIEWPORTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 834, height: 1194 },
  { name: "desktop", width: 1440, height: 900 },
];

/**
 * OS colour scheme x app theme — all four, because they are separate inputs.
 *
 * Tailwind's `dark:` variant and the app's own theme toggle were driven by
 * different things: the utilities by prefers-color-scheme, the CSS custom
 * properties by a `.dark` class. An audit that only ever ran the default pair
 * (OS light, app light) could not see it. On OS dark + app light, "offen"
 * rendered pale yellow text on a white row.
 */
const THEMES = [
  { name: "hell", os: "light", app: "light" },
  { name: "dunkel", os: "dark", app: "dark" },
  // The two mismatched combinations are the ones that were broken, and are the
  // default for anyone whose OS and app disagree.
  { name: "hell/OS-dunkel", os: "dark", app: "light" },
  { name: "dunkel/OS-hell", os: "light", app: "dark" },
];

/** Extra interactions that reveal surfaces a plain page load does not. */
const SCENARIOS = [
  {
    name: "Projekte · Kacheln",
    route: "/projects",
    async run(page) {
      await page.click('[aria-label="Kachelansicht"]');
      await page.waitForTimeout(1200);
    },
  },
  {
    name: "Projekte · Detaildialog",
    route: "/projects",
    async run(page) {
      await page.click('[aria-label="Kachelansicht"]');
      await page.waitForTimeout(1000);
      await page.evaluate(() => {
        document
          .querySelector("[data-project-card]")
          ?.querySelector('button[aria-label^="Details"]')
          ?.click();
      });
      await page.waitForTimeout(900);
    },
  },
  {
    name: "Dashboard · Projektdialog",
    route: "/",
    async run(page) {
      await page.evaluate(() => {
        const el = [...document.querySelectorAll("button, [role='button']")].find((b) =>
          /Details|Projekt/i.test(b.textContent ?? ""),
        );
        el?.click();
      });
      await page.waitForTimeout(900);
    },
  },
  // The two Gewerk workspaces are the Projekte surface scoped to one
  // department, so they have the same card grid, the same filter panel and the
  // same dialog — and the same chances to spill, overlap or drop contrast. A
  // plain page load only ever measures the table.
  {
    name: "BVB-EEA · Kacheln + Filter",
    route: "/bvb-eea",
    async run(page) {
      await page.getByRole("button", { name: "Filter", exact: true }).click();
      await page.click('[aria-label="Kachelansicht"]');
      await page.waitForTimeout(1200);
    },
  },
  {
    name: "PSV-ITK · Detaildialog",
    route: "/psv-itk",
    async run(page) {
      await page.evaluate(() => {
        document.querySelector('table tbody tr button[aria-label^="Details"]')?.click();
      });
      await page.waitForTimeout(1200);
    },
  },
  /*
   * The table, scrolled sideways.
   *
   * Every scenario until now measured the table at scrollLeft 0, so the columns
   * past the fold were never audited — and that is exactly where the status
   * cell rendered a badge and a select on top of each other with the row's
   * action buttons over the pair. A gate that only ever looks at the first
   * screenful of a twelve-column table is not auditing the table.
   */
  {
    name: "BVB-EEA · Tabelle gescrollt",
    route: "/bvb-eea",
    async run(page) {
      await page.waitForSelector("table tbody tr", { timeout: 20000 });
      await page.evaluate(() => {
        const scroller = document.querySelector("table")?.closest("[class*='overflow-x-auto']");
        if (scroller) scroller.scrollLeft = scroller.scrollWidth;
      });
      await page.waitForTimeout(600);
    },
  },
  {
    name: "Projekte · Tabelle gescrollt",
    route: "/projects",
    async run(page) {
      await page.waitForSelector("table tbody tr", { timeout: 20000 });
      await page.evaluate(() => {
        const scroller = document.querySelector("table")?.closest("[class*='overflow-x-auto']");
        if (scroller) scroller.scrollLeft = scroller.scrollWidth;
      });
      await page.waitForTimeout(600);
    },
  },
  {
    name: "Suche · Ergebnisliste",
    route: "/",
    async run(page) {
      await page.fill('[role="combobox"]', "Frankfurt");
      await page.waitForSelector('[role="option"]', { timeout: 8000 });
      await page.waitForTimeout(400);
    },
  },
  {
    name: "Dashboard · Relief",
    route: "/",
    async run(page) {
      await page.waitForSelector(".relief-cell", { timeout: 20000 });
      await page.waitForTimeout(600);
    },
  },
  {
    name: "Dashboard · Relief flach",
    route: "/",
    async run(page) {
      await page.waitForSelector(".relief-cell", { timeout: 20000 });
      await page.getByRole("button", { name: "Flach" }).click();
      await page.waitForTimeout(600);
    },
  },
  {
    name: "Dashboard · Präsentationsmodus",
    route: "/",
    async run(page) {
      await page.waitForSelector("[data-gewerk]", { timeout: 20000 });
      await page.getByRole("button", { name: /Präsentationsmodus/ }).click();
      await page.waitForTimeout(900);
    },
  },
  {
    name: "Ask Bahn · Antwort",
    route: "/",
    async run(page) {
      await page.getByRole("button", { name: /^Ask Bahn öffnen/ }).click();
      await page.waitForSelector("[data-ask-bahn='open']", { timeout: 15000 });
      await page.getByLabel("Frage an Ask Bahn").fill("Was ist gerade kritisch?");
      await page.getByRole("button", { name: "Fragen" }).click();
      await page.waitForTimeout(700);
    },
  },
  {
    name: "Dashboard · Relief gedreht",
    route: "/",
    async run(page) {
      await page.waitForSelector(".relief-cell", { timeout: 20000 });
      await page.locator(".relief-stage").scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const box = await page.locator(".relief-stage").boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 140, box.y + box.height / 2 - 40, { steps: 6 });
        await page.mouse.up();
      }
      await page.waitForTimeout(600);
    },
  },
  {
    name: "Anmeldung · Prüfungen",
    route: "/anmeldung",
    async run(page) {
      await page.getByRole("button", { name: /^Schritt 3:/ }).click();
      await page.waitForTimeout(900);
    },
  },
];

/** Injected into the page: the whole measurement lives here. */
const AUDIT = () => {
  /**
   * Painted, not merely present.
   *
   * getBoundingClientRect returns an element's geometric box even when an
   * ancestor's overflow clips it away entirely. The Dashboard's workload panel
   * is `max-h-[720px] overflow-auto` over 44 entries, so the rows scrolled out
   * of it kept reporting boxes that intersected the cards further down the
   * page — 132 "overlaps" that no one can see. Anything clipped out of every
   * scrollport it sits in is not on screen.
   */
  const VISIBLE = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;

    let node = el.parentElement;
    while (node && node !== document.documentElement) {
      const ncs = getComputedStyle(node);
      if (/hidden|clip|auto|scroll/.test(ncs.overflow + ncs.overflowX + ncs.overflowY)) {
        const nr = node.getBoundingClientRect();
        const vx = Math.min(r.right, nr.right) - Math.max(r.left, nr.left);
        const vy = Math.min(r.bottom, nr.bottom) - Math.max(r.top, nr.top);
        if (vx <= 1 || vy <= 1) return false;
      }
      node = node.parentElement;
    }
    return true;
  };

  const ownText = (el) => {
    let t = "";
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
    return t.replace(/\s+/g, " ").trim();
  };

  /*
   * Any CSS colour, resolved to sRGB — including the ones Tailwind v4 emits.
   *
   * This used to match rgb()/rgba() and return null for anything else. Chrome
   * serialises `bg-primary/90` as `oklab(0.59 0.21 0.11 / 0.9)`, so the button
   * behind a piece of white text came back as "no colour", the walk fell
   * through to the page background, and the audit reported white text on white
   * — 1:1 — for a control that is in fact white on red. It is the same failure
   * the sticky-column opacity test had, in the other half of the file.
   *
   * Rather than implement oklab→sRGB by hand, the browser converts it: a 1×1
   * canvas is painted with the colour and the pixel read back. The canvas is
   * created once and reused, and the result is memoised, because this runs for
   * every ancestor of every text node on the page.
   */
  const COLOUR_CACHE = new Map();
  let colourCtx = null;
  const paintOn = (value, backdrop) => {
    colourCtx.globalCompositeOperation = "source-over";
    colourCtx.fillStyle = backdrop;
    colourCtx.fillRect(0, 0, 1, 1);
    colourCtx.fillStyle = "#7f7f7f";
    colourCtx.fillStyle = value;
    colourCtx.fillRect(0, 0, 1, 1);
    return colourCtx.getImageData(0, 0, 1, 1).data;
  };
  const parseRgb = (s) => {
    const key = String(s);
    if (COLOUR_CACHE.has(key)) return COLOUR_CACHE.get(key);
    let out = null;
    const m = key.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(",").map((x) => Number.parseFloat(x.trim()));
      out = { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    } else if (key && key !== "none" && key !== "transparent") {
      if (!colourCtx) {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        colourCtx = canvas.getContext("2d", { willReadFrequently: true });
      }
      try {
        /*
         * Two known backdrops, solved exactly.
         *
         * Reading a single painted pixel and dividing by its alpha to recover
         * the colour amplifies the 1/255 quantisation by 1/a: at a = 0.05 —
         * which is what `bg-primary/5` on the wizard's step button is — it
         * turned a barely-tinted white into solid red, and produced channel
         * values above 255. Painting over white and over black instead gives
         *   white:  Cw = C·a + 255(1−a)
         *   black:  Cb = C·a
         * so a = 1 − (Cw − Cb)/255 from a full-range difference, and any error
         * left in C is multiplied by a when it is composited back — which is
         * exactly where it does not matter.
         */
        const w = paintOn(key, "#ffffff");
        const b = paintOn(key, "#000000");
        const alphas = [0, 1, 2].map((i) => 1 - (w[i] - b[i]) / 255);
        alphas.sort((x, y) => x - y);
        const a = Math.min(1, Math.max(0, alphas[1]));
        out =
          a <= 0.002
            ? { r: 0, g: 0, b: 0, a: 0 }
            : {
                r: Math.min(255, Math.max(0, b[0] / a)),
                g: Math.min(255, Math.max(0, b[1] / a)),
                b: Math.min(255, Math.max(0, b[2] / a)),
                a,
              };
      } catch {
        out = null;
      }
    }
    COLOUR_CACHE.set(key, out);
    return out;
  };

  /** Flatten a colour onto an opaque backdrop. */
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });

  const lum = (c) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };

  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  /** The painted background behind an element, walking up through transparency. */
  const backdrop = (el) => {
    let acc = null;
    let node = el;
    while (node && node !== document.documentElement) {
      const c = parseRgb(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0) {
        acc = acc === null ? c : over(acc, c);
        if (acc.a >= 0.999) return acc;
      }
      node = node.parentElement;
    }
    const root = parseRgb(getComputedStyle(document.documentElement).backgroundColor);
    const base = root && root.a > 0 ? root : { r: 255, g: 255, b: 255, a: 1 };
    return acc === null ? base : over(acc, base);
  };

  /** Nearest ancestor that actually draws a box, i.e. a visual container. */
  const container = (el) => {
    let node = el.parentElement;
    while (node && node !== document.body) {
      const cs = getComputedStyle(node);
      const bg = parseRgb(cs.backgroundColor);
      const hasBg = bg && bg.a > 0.05;
      const hasBorder =
        Number.parseFloat(cs.borderTopWidth) > 0 || Number.parseFloat(cs.borderLeftWidth) > 0;
      const clips = /hidden|clip|auto|scroll/.test(cs.overflow + cs.overflowX + cs.overflowY);
      if (hasBg || hasBorder || clips) return { node, cs, clips };
      node = node.parentElement;
    }
    return null;
  };

  const spills = [];
  const contrast = [];
  const sizes = new Map();
  const weights = new Map();
  const families = new Map();
  const textBoxes = [];

  // Only the layer the user is actually looking at. With a dialog open, the
  // page behind it is still in the DOM and every pair across the two would
  // read as an overlap.
  const dialog = [...document.querySelectorAll("[role='dialog']")].filter(VISIBLE).pop();
  const all = dialog
    ? dialog.querySelectorAll("*")
    : document.querySelectorAll("main *, header *");

  for (const el of all) {
    if (!VISIBLE(el)) continue;
    // Chart internals lay themselves out in their own coordinate space and
    // are not part of the document's typography.
    if (el.closest("svg, .recharts-wrapper, .leaflet-container")) continue;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const text = ownText(el);

    // ---- 4. scale inventory ------------------------------------------------
    if (text) {
      const px = Math.round(Number.parseFloat(cs.fontSize) * 100) / 100;
      sizes.set(px, (sizes.get(px) ?? 0) + 1);
      weights.set(cs.fontWeight, (weights.get(cs.fontWeight) ?? 0) + 1);
      families.set(cs.fontFamily.split(",")[0].replace(/["']/g, ""), (families.get(cs.fontFamily.split(",")[0].replace(/["']/g, "")) ?? 0) + 1);
    }

    // ---- 1. spill ----------------------------------------------------------
    if (text || el.childElementCount === 0) {
      const c = container(el);
      if (c) {
        const cr = c.node.getBoundingClientRect();
        const padR = Number.parseFloat(c.cs.paddingRight) || 0;
        const padL = Number.parseFloat(c.cs.paddingLeft) || 0;
        const padB = Number.parseFloat(c.cs.paddingBottom) || 0;
        // A scrollable container is allowed to hold content larger than itself.
        const scrollable =
          c.node.scrollWidth > c.node.clientWidth + 1 || c.node.scrollHeight > c.node.clientHeight + 1;
        const right = rect.right - (cr.right - padR);
        const left = cr.left + padL - rect.left;
        const bottom = rect.bottom - (cr.bottom - padB);
        const worst = Math.max(right, left, bottom);
        if (!scrollable && worst > 1.5) {
          spills.push({
            text: text.slice(0, 46),
            tag: el.tagName.toLowerCase(),
            cls: String(el.className).slice(0, 54),
            by: Math.round(worst),
            side: worst === right ? "rechts" : worst === left ? "links" : "unten",
            box: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
            into: String(c.node.className).slice(0, 40),
          });
        }
      }
    }

    // ---- 3. contrast -------------------------------------------------------
    if (text && text.length > 1) {
      const fg = parseRgb(cs.color);
      if (fg) {
        const bg = backdrop(el);
        const flat = fg.a < 1 ? over(fg, bg) : fg;
        const px = Number.parseFloat(cs.fontSize);
        const bold = Number.parseInt(cs.fontWeight, 10) >= 700;
        const large = px >= 24 || (px >= 18.66 && bold);
        const need = large ? 3 : 4.5;
        const got = ratio(flat, bg);
        if (got < need - 0.05) {
          contrast.push({
            text: text.slice(0, 46),
            cls: String(el.className).slice(0, 54),
            ratio: Math.round(got * 100) / 100,
            need,
            px: Math.round(px * 10) / 10,
            fg: `rgb(${Math.round(flat.r)},${Math.round(flat.g)},${Math.round(flat.b)})`,
            bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
          });
        }
      }
      textBoxes.push({
        el,
        text,
        cls: String(el.className).slice(0, 40),
        x: rect.x, y: rect.y, w: rect.width, h: rect.height,
      });
    }
  }

  // ---- 2. text painted over text -------------------------------------------
  //
  // Three kinds of intersection are NOT a defect and are excluded, or the
  // report drowns in them:
  //
  //   - a box inside its own ancestor's box ("1.298" inside the <span> that
  //     also says "Projekte gefunden"). Nesting is not collision.
  //   - two elements in different stacking contexts, e.g. a dialog painted
  //     over the page behind it. Only the topmost layer is audited.
  //   - anything mid-animation. The context runs with reduced motion, but a
  //     transformed ancestor is still excluded on principle.
  const overlaps = [];

  /*
   * Two more kinds of legitimate cover, added after the sticky identity columns
   * and the search palette landed.
   *
   *   - a `position: sticky` element with an opaque background. A pinned column
   *     or a pinned table header is *designed* to be painted over the rows
   *     scrolling beneath it; reporting that as text-on-text produced 40
   *     findings on one scrolled table, none of them visible to anyone.
   *   - a popup layer: dialog, listbox or menu. The search palette floats over
   *     the Dashboard by definition.
   *
   * Deliberately narrow. `position: absolute` is NOT exempt, because that is
   * exactly what the map's old "Interaktive Projektkarte" card was when it
   * covered 41% of the map legend — a 36,252px² defect this check found. An
   * absolutely-positioned box sitting on top of content is still a finding.
   */
  /*
   * `data-overlay` is the explicit opt-in.
   *
   * The role-based selectors below cover the layers that announce themselves
   * through ARIA. The Ask Bahn panel is deliberately an <aside> — it is not a
   * modal and must not claim to be one — so it carries the marker instead of
   * acquiring a role it does not deserve. Opting in by attribute keeps this
   * narrow: `position: fixed` in general stays audited, because that is what
   * the map's legend-covering card was.
   */
  const OVERLAY =
    "[role='dialog'],[role='listbox'],[role='menu'],[data-radix-popper-content-wrapper],[data-overlay]";
  /*
   * Is this background actually painted?
   *
   * The first version only understood rgb()/rgba(). Tailwind v4 emits oklch()
   * for most of its palette, so `dark:bg-zinc-950` came back as
   * "oklch(0.141 0.005 285.823)", failed the rgb match, and the sticky column
   * was judged transparent — which reported 23 phantom overlaps in dark mode
   * and none in light, where `bg-white` happens to serialise as rgb.
   *
   * Anything that is not `transparent` and carries no alpha below 1 is paint,
   * whatever colour space it is expressed in.
   */
  const opaque = (color) => {
    if (!color) return false;
    const c = color.trim().toLowerCase();
    if (c === "transparent" || c === "rgba(0, 0, 0, 0)") return false;
    const rgba = c.match(/rgba?\(([^)]+)\)/);
    if (rgba) {
      const parts = rgba[1].split(",").map((v) => Number.parseFloat(v));
      return parts.length < 4 || parts[3] >= 0.99;
    }
    // oklch(L C H / A), lab(... / A), color(srgb r g b / A) — alpha after "/".
    const slash = c.match(/\/\s*([\d.]+%?)\s*\)/);
    if (slash) {
      const raw = slash[1];
      const value = raw.endsWith("%") ? Number.parseFloat(raw) / 100 : Number.parseFloat(raw);
      return value >= 0.99;
    }
    return true;
  };
  const stickyCover = (el) => {
    let n = el;
    while (n && n !== document.body) {
      const cs = getComputedStyle(n);
      if (cs.position === "sticky" && opaque(cs.backgroundColor)) return n;
      n = n.parentElement;
    }
    return null;
  };

  const transformed = (el) => {
    let n = el;
    while (n && n !== document.body) {
      const t = getComputedStyle(n).transform;
      if (t && t !== "none") return true;
      n = n.parentElement;
    }
    return false;
  };
  const sorted = [...textBoxes]
    .filter((b) => !transformed(b.el))
    .sort((a, b) => a.y - b.y);
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      if (b.y >= a.y + a.h) break; // sorted by y: nothing further can overlap
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      if (a.el.closest(OVERLAY) !== b.el.closest(OVERLAY)) continue;
      const aSticky = stickyCover(a.el);
      const bSticky = stickyCover(b.el);
      if (aSticky !== bSticky) continue;
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 2 && oy > 2) {
        overlaps.push({
          a: a.text.slice(0, 30),
          b: b.text.slice(0, 30),
          area: Math.round(ox * oy),
          aCls: a.cls,
          bCls: b.cls,
        });
      }
    }
  }

  return {
    spills,
    overlaps,
    contrast,
    sizes: [...sizes.entries()].sort((x, y) => x[0] - y[0]),
    weights: [...weights.entries()].sort((x, y) => y[1] - x[1]),
    families: [...families.entries()].sort((x, y) => y[1] - x[1]),
  };
};

let failures = 0;
const allSizes = new Map();
const allWeights = new Map();
const allFamilies = new Map();
const seen = new Set();

async function audit(label, viewport, route, interact, theme = THEMES[0]) {
  const ctx = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    isMobile: viewport.width < 800,
    hasTouch: viewport.width < 900,
    colorScheme: theme.os,
    // Every entrance animation settled before anything is measured; a
    // framer-motion element mid-flight overlaps things it will not overlap.
    reducedMotion: "reduce",
  });
  await ctx.addInitScript(
    ([u, appTheme]) => {
      localStorage.setItem("bahn-demo-user", JSON.stringify(u));
      // The same key ThemeContext reads, so the app boots in this theme
      // rather than flipping after first paint.
      localStorage.setItem("theme", appTheme);
    },
    [DEMO_USER, theme.app],
  );
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2200);
  if (interact) {
    try {
      await interact(page);
    } catch {
      // A scenario that cannot reach its surface at this width is not a
      // rendering defect; the responsive suite covers reachability.
      await ctx.close();
      return;
    }
  }
  const r = await page.evaluate(AUDIT);

  for (const [k, v] of r.sizes) allSizes.set(k, (allSizes.get(k) ?? 0) + v);
  for (const [k, v] of r.weights) allWeights.set(k, (allWeights.get(k) ?? 0) + v);
  for (const [k, v] of r.families) allFamilies.set(k, (allFamilies.get(k) ?? 0) + v);

  const problems = r.spills.length + r.overlaps.length + r.contrast.length;
  const tag = `${label} @${viewport.name}·${theme.name}`;
  if (problems === 0) {
    console.log(`✅ ${tag.padEnd(46)} spill 0  overlap 0  contrast 0`);
  } else {
    failures++;
    console.log(
      `❌ ${tag.padEnd(46)} spill ${r.spills.length}  overlap ${r.overlaps.length}  contrast ${r.contrast.length}`,
    );
    for (const s of r.spills.slice(0, 6)) {
      const key = `spill|${s.cls}|${s.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`     spill ${s.by}px ${s.side}: "${s.text}" <${s.tag}> ${s.box}`);
      console.log(`           class ${s.cls}`);
    }
    for (const o of r.overlaps.slice(0, 6)) {
      const key = `ovl|${o.aCls}|${o.bCls}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`     overlap ${o.area}px²: "${o.a}" × "${o.b}"`);
    }
    for (const c of r.contrast.slice(0, 8)) {
      const key = `ctr|${c.cls}|${c.fg}|${c.bg}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(
        `     contrast ${c.ratio}:1 (needs ${c.need}) ${c.px}px "${c.text}" ${c.fg} on ${c.bg}`,
      );
      console.log(`           class ${c.cls}`);
    }
  }
  await ctx.close();
}

/**
 * Every class the shared tone table names must actually be in the stylesheet.
 *
 * Tailwind only emits a utility it has seen in a scanned source. shared/ was
 * outside the scan, so four of the eight tone backgrounds silently never
 * shipped and 81 % of status badges rendered transparent. Reading the built
 * CSS is the only way to catch that: the TypeScript compiles, the classes are
 * on the elements, and nothing anywhere reports a problem.
 */
console.log("== palette ==");
{
  const cssFile = fs
    .readdirSync(path.join(ROOT, "assets"))
    .find((f) => /^index-.*\.css$/.test(f));
  const css = fs.readFileSync(path.join(ROOT, "assets", cssFile), "utf8");
  const src = fs.readFileSync(
    path.resolve(__dirname, "..", "shared", "status-appearance.ts"),
    "utf8",
  );
  const classes = [
    ...new Set(
      [...src.matchAll(/badge:\s*"([^"]+)"/g)]
        .flatMap((m) => m[1].split(/\s+/))
        .filter((c) => c && !c.startsWith("dark:")),
    ),
  ];
  const missing = classes.filter((c) => !css.includes(`.${c}`));
  if (missing.length) {
    failures++;
    console.log(`❌ ${missing.length} of ${classes.length} tone classes are not in the built CSS:`);
    for (const m of missing) console.log(`     .${m}`);
  } else {
    console.log(`✅ all ${classes.length} tone classes present in the built CSS`);
  }
}

console.log("\n== rendering ==");
for (const vp of VIEWPORTS) {
  for (const route of ROUTES) await audit(route.name, vp, route.path, null);
  for (const sc of SCENARIOS) await audit(sc.name, vp, sc.route, sc.run);
}

/*
 * The other three theme combinations, at one viewport.
 *
 * Layout does not change with the theme, so re-running every viewport would
 * only re-measure the same geometry three more times. Colour does change, and
 * that is what these catch.
 */
console.log("\n== themes ==");
for (const theme of THEMES.slice(1)) {
  for (const route of ROUTES) {
    await audit(route.name, VIEWPORTS[2], route.path, null, theme);
  }
  for (const sc of SCENARIOS) {
    await audit(sc.name, VIEWPORTS[2], sc.route, sc.run, theme);
  }
}

console.log("\n== typography ==");
const offScale = [...allSizes.entries()]
  .filter(([px]) => !TYPE_SCALE.includes(Math.round(px)))
  .sort((a, b) => b[1] - a[1]);
console.log(
  `font families: ${[...allFamilies.entries()].map(([f, n]) => `${f} (${n})`).join(", ")}`,
);
console.log(
  `font weights:  ${[...allWeights.entries()].map(([w, n]) => `${w} (${n})`).join(", ")}`,
);
if (SHOW_INVENTORY) {
  console.log(
    `font sizes:    ${[...allSizes.entries()].sort((a, b) => a[0] - b[0]).map(([p, n]) => `${p}px (${n})`).join(", ")}`,
  );
}
if (offScale.length) {
  failures++;
  console.log(`❌ ${offScale.length} size(s) outside the type scale [${TYPE_SCALE.join(", ")}]:`);
  for (const [px, n] of offScale) console.log(`     ${px}px on ${n} element(s)`);
} else {
  console.log(`✅ every rendered size is on the scale [${TYPE_SCALE.join(", ")}]`);
}
if (allFamilies.size > 2) {
  failures++;
  console.log(`❌ ${allFamilies.size} font families rendered; expected at most 2 (UI + mono)`);
}

await browser.close();
server.close();
console.log(failures === 0 ? "\n🎉 UI CLEAN\n" : `\n🔥 ${failures} SURFACE(S) WITH DEFECTS\n`);
process.exit(failures === 0 ? 0 : 1);
