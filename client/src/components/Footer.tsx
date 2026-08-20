import { ArrowUp, Package } from "lucide-react";
import { useAllProjects } from "@/hooks/useDataQuery";

/**
 * Global footer.
 *
 * Three things were wrong here and all three were the same class of defect —
 * the footer stating something it had no way of knowing:
 *
 *   1. `appVersion = "1.0.0"` was a string literal while package.json said
 *      2.0.0. It is now injected from package.json at build time (see
 *      `__APP_VERSION__` in vite.config.ts), so it cannot drift again.
 *   2. `Last updated: {new Date().toLocaleDateString()}` rendered *today's*
 *      date on every single page load, so the app always claimed to have been
 *      updated today. Replaced with the real build timestamp.
 *   3. "Alle Systeme betriebsbereit" was hardcoded green. It now reflects
 *      whether the project query actually resolved.
 *
 * Layout: the inner wrapper uses `app-shell`, the same utility the header and
 * the page content use, so all three share one left edge and one right edge.
 * It previously used `max-w-screen-2xl` (1536px) against the header's
 * unconstrained width, which put the footer 38px inside the header on a 1920px
 * display and 20px outside the page content on a phone.
 *
 * Colours: the surface is a hardcoded #1A1A1A in both themes, so it cannot use
 * `text-muted-foreground` — that token resolves against the *page* theme and
 * rendered near-black-on-black in light mode. Fixed opacities on a known
 * background instead.
 */

/** Frozen at build time rather than recomputed on every render. */
const BUILD_YEAR = new Date(__BUILD_DATE__).getFullYear();

const LEGAL_LINKS = [
  { label: "Impressum", href: "https://www.deutschebahn.com/de/impressum-1187944" },
  { label: "Datenschutz", href: "https://www.deutschebahn.com/de/konzern/datenschutz-6890700" },
  {
    label: "Barrierefreiheit",
    href: "https://www.deutschebahn.com/de/konzern/barrierefreiheit-12227918",
  },
] as const;

const SUPPORT_LINKS = [
  {
    label: "GitHub Repository",
    href: "https://github.com/iceccarelli/bahn-project-manager",
  },
  {
    label: "Issue melden",
    href: "https://github.com/iceccarelli/bahn-project-manager/issues/new",
  },
] as const;

export default function Footer() {
  const { data, isError, isLoading } = useAllProjects();

  const scrollToTop = () => {
    document
      .querySelector("main")
      ?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const status = isError
    ? { dot: "bg-amber-400", text: "Daten nicht erreichbar" }
    : isLoading
      ? { dot: "bg-white/40", text: "Daten werden geladen" }
      : {
          dot: "bg-emerald-400",
          text: `${(data?.projects?.length ?? 0).toLocaleString("de-DE")} Projekte geladen`,
        };

  return (
    <footer className="shrink-0 border-t border-[#FF0000] bg-[#1A1A1A] py-6 text-[#eaeded]">
      <div className="app-shell">
        <div className="mb-6 grid grid-cols-2 gap-6 md:grid-cols-4 md:gap-8">
          <div>
            <div className="mb-3 flex items-center gap-x-2">
              <span className="flex h-5 w-5 items-center justify-center rounded bg-[#FF0000] text-2xs font-bold leading-none text-white">
                DB
              </span>
              <span className="text-xs font-bold md:text-sm">Bahn Project Manager</span>
            </div>
            <p className="text-xs text-white/70">
              © {BUILD_YEAR} Deutsche Bahn AG · Alle Rechte vorbehalten
            </p>
            <p className="mt-1 text-xs text-white/70">
              Internes Werkzeug — Regionalbereich Mitte
            </p>
          </div>

          <nav aria-labelledby="footer-legal" className="space-y-2">
            <h2 id="footer-legal" className="mb-2 text-xs font-bold text-[#eaeded]">
              Rechtliches
            </h2>
            {LEGAL_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs text-white/80 transition-colors hover:text-[#FF0000] hover:underline"
              >
                {l.label}
              </a>
            ))}
          </nav>

          <nav aria-labelledby="footer-support" className="space-y-2">
            <h2 id="footer-support" className="mb-2 text-xs font-bold text-[#eaeded]">
              Support
            </h2>
            {SUPPORT_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs text-white/80 transition-colors hover:text-[#FF0000] hover:underline"
              >
                {l.label}
              </a>
            ))}
          </nav>

          <div className="flex flex-col gap-y-3">
            {/* <output> is the semantic element for a live result; it carries an
                implicit role="status" so screen readers announce the change
                when the query resolves, without an explicit ARIA role. */}
            <output className="flex items-center gap-1.5 text-xs font-medium text-white/90">
              <span
                className={`inline-block h-2 w-2 shrink-0 rounded-full ${status.dot}`}
                aria-hidden="true"
              />
              {status.text}
            </output>
            <p className="flex items-center gap-x-2 text-xs text-white/70">
              <Package className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span>
                v{__APP_VERSION__}
                <span className="sr-only">, </span>
                <span className="ml-1 font-mono text-2xs opacity-70">
                  {__BUILD_DATE__}
                </span>
              </span>
            </p>
            <button
              type="button"
              onClick={scrollToTop}
              className="mt-auto flex items-center gap-1 text-xs text-white/80 underline transition-colors hover:text-[#FF0000]"
            >
              <ArrowUp className="h-3 w-3" aria-hidden="true" />
              Nach oben
            </button>
          </div>
        </div>

        <div className="border-t border-white/15 pt-4 text-xs text-white/60">
          <p>Bahn Project Manager — Fachspezialistenprüfung RB Mitte</p>
        </div>
      </div>
    </footer>
  );
}
