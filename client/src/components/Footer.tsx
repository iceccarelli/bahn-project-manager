import { Globe, ArrowUp, Package } from "lucide-react";

export default function Footer() {
  const currentYear = new Date().getFullYear();
  const appVersion = "1.0.0";

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <footer className="aws-footer border-t border-[#FF0000] py-6 px-4 md:px-6 text-sm bg-[#1A1A1A] text-[#eaeded] shrink-0">
      <div className="max-w-screen-2xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8 mb-6">
          <div>
            <div className="flex items-center gap-x-2 mb-3">
              <Globe className="h-4 w-4" />
              <span className="font-medium text-xs md:text-sm">Deutsch (DE)</span>
            </div>
            <p className="text-xs opacity-70">
              © {currentYear} Deutsche Bahn AG • Alle Rechte vorbehalten
            </p>
            <p className="text-xs opacity-70 mt-1">Bahn Project Manager – Internes Tool</p>
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-[#eaeded] mb-2">Rechtliches</h4>
            <a href="#" className="block text-xs hover:text-[#FF0000] hover:underline transition-colors">Impressum</a>
            <a href="#" className="block text-xs hover:text-[#FF0000] hover:underline transition-colors">Datenschutz</a>
            <a href="#" className="block text-xs hover:text-[#FF0000] hover:underline transition-colors">AGB</a>
            <a href="#" className="block text-xs hover:text-[#FF0000] hover:underline transition-colors">Barrierefreiheit</a>
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-[#eaeded] mb-2">Support</h4>
            <a href="#" className="block text-xs hover:text-[#FF0000] hover:underline transition-colors">Dokumentation</a>
            <a href="#" className="block text-xs hover:text-[#FF0000] hover:underline transition-colors">Hilfe & Support</a>
            <a href="https://github.com/iceccarelli/bahn-project-manager" target="_blank" rel="noopener noreferrer" className="block text-xs hover:text-[#FF0000] hover:underline transition-colors">GitHub Repository</a>
          </div>

          <div className="flex flex-col gap-y-3">
            <div className="flex items-center gap-x-2">
              <div className="flex items-center text-emerald-400 text-xs font-medium gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
                Alle Systeme betriebsbereit
              </div>
            </div>
            <div className="flex items-center gap-x-2 text-xs text-muted-foreground">
              <Package className="h-3 w-3" />
              <span>v{appVersion}</span>
            </div>
            <button
              onClick={scrollToTop}
              className="text-xs flex items-center gap-1 underline hover:text-[#FF0000] transition-colors mt-auto"
              aria-label="Nach oben scrollen"
            >
              <ArrowUp className="h-3 w-3" />
              Nach oben
            </button>
          </div>
        </div>

        <div className="border-t border-border/30 pt-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 text-xs text-muted-foreground">
          <p>Bahn Project Manager – Collaborative Project Review Platform</p>
          <p className="text-xs opacity-60">Last updated: {new Date( ).toLocaleDateString('de-DE')}</p>
        </div>
      </div>
    </footer>
  );
}
