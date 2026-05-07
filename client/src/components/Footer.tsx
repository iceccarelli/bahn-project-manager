import { Globe, ArrowUp } from "lucide-react";

export default function Footer() {
  return (
    <footer className="aws-footer border-t-2 border-[#FF0000] py-8 px-6 text-sm mt-auto bg-[#1A1A1A] text-[#eaeded]">
      <div className="max-w-screen-2xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-[#eaeded]">
        {/* Language / Copyright */}
        <div>
          <div className="flex items-center gap-x-2 mb-4">
            <Globe className="h-5 w-5" />
            <span className="font-medium">Deutsch (DE)</span>
          </div>
          <p className="text-xs opacity-70">© 2026 Deutsche Bahn AG • Alle Rechte vorbehalten</p>
          <p className="text-xs opacity-70 mt-1">Bahn Project Manager – Internes Tool</p>
        </div>

        {/* Legal */}
        <div className="space-y-2">
          <a href="#" className="block hover:text-[#FF0000] hover:underline transition-colors">Impressum</a>
          <a href="#" className="block hover:text-[#FF0000] hover:underline transition-colors">Datenschutz</a>
          <a href="#" className="block hover:text-[#FF0000] hover:underline transition-colors">AGB</a>
          <a href="#" className="block hover:text-[#FF0000] hover:underline transition-colors">Barrierefreiheit</a>
        </div>

        {/* Service links */}
        <div className="space-y-2">
          <a href="#" className="block hover:text-[#FF0000] hover:underline transition-colors">Dokumentation</a>
          <a href="#" className="block hover:text-[#FF0000] hover:underline transition-colors">Hilfe &amp; Support</a>
          <a
            href="https://github.com/iceccarelli/bahn-project-manager"
            target="_blank"
            rel="noopener noreferrer"
            className="block hover:text-[#FF0000] hover:underline transition-colors"
          >
            GitHub Repository
          </a>
        </div>

        {/* Status / Back to top */}
        <div className="flex flex-col gap-y-2">
          <div className="flex items-center gap-x-3">
            <div className="flex items-center text-emerald-400 text-xs font-medium">
              ● Alle Systeme betriebsbereit
            </div>
          </div>
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="text-xs flex items-center gap-1 underline hover:text-[#FF0000] mt-auto self-start transition-colors"
            aria-label="Nach oben"
          >
            <ArrowUp className="h-3 w-3" />
            Nach oben
          </button>
        </div>
      </div>
    </footer>
  );
}
