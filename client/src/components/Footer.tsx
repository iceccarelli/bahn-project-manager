import { Globe } from "lucide-react";

export default function Footer() {
  return (
    <footer className="aws-footer border-t border-[#545b64] py-8 px-6 text-sm mt-auto">
      <div className="max-w-screen-2xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-[#eaeded]">
        {/* Language */}
        <div>
          <div className="flex items-center gap-x-2 mb-4">
            <Globe className="h-5 w-5" />
            <span className="font-medium">Deutsch (DE)</span>
          </div>
          <p className="text-xs opacity-70">© 2026 Bahn Project Manager • All rights reserved</p>
        </div>

        {/* Legal */}
        <div className="space-y-2">
          <a href="#" className="block hover:text-[#ff9900] hover:underline transition-colors">Terms of Service</a>
          <a href="#" className="block hover:text-[#ff9900] hover:underline transition-colors">Privacy Notice</a>
          <a href="#" className="block hover:text-[#ff9900] hover:underline transition-colors">Cookie Preferences</a>
        </div>

        {/* Service links */}
        <div className="space-y-2">
          <a href="#" className="block hover:text-[#ff9900] hover:underline transition-colors">Documentation</a>
          <a href="#" className="block hover:text-[#ff9900] hover:underline transition-colors">API Reference</a>
          <a
            href="https://github.com/iceccarelli/bahn-project-manager"
            target="_blank"
            rel="noopener noreferrer"
            className="block hover:text-[#ff9900] hover:underline transition-colors"
          >
            GitHub Repository
          </a>
        </div>

        {/* Social / Status / Back to top */}
        <div className="flex flex-col gap-y-2">
          <div className="flex items-center gap-x-3">
            <a href="#" aria-label="X / Twitter" className="text-xl hover:text-[#ff9900] transition-colors">𝕏</a>
            <div className="flex items-center text-emerald-400 text-xs font-medium">
              ● Status: All Systems Operational
            </div>
          </div>
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="text-xs underline hover:text-[#ff9900] mt-auto self-start transition-colors"
            aria-label="Back to top"
          >
            Back to top ↑
          </button>
        </div>
      </div>
    </footer>
  );
}
