/**
 * Ask Bahn — the assistant, as a panel.
 *
 * The shape is the one people already know from AWS's assistant: a launcher in
 * the corner, a panel with starter prompts, a transcript, an input. What is
 * behind it is different, and deliberately so — see shared/agent/types.ts.
 * Every figure in every answer is computed on the spot from the loaded data and
 * carries the derivation with it, because an assistant that is confidently
 * wrong about 18,172 review rows is worse than no assistant.
 *
 * Three rules this panel keeps:
 *   — it never blocks the page: Escape closes it, focus returns to the
 *     launcher, and it is a dialog only in the ARIA sense, not a modal that
 *     traps a reader who opened it by accident;
 *   — every answer offers the screen where it can be checked, so no figure is
 *     ever a dead end;
 *   — when it does not understand, it says so and lists what it can do. It
 *     never produces a sentence it cannot support.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Bot, CornerDownLeft, ExternalLink, Sparkles, X } from "lucide-react";
import { useAllData, useAuditLog } from "@/hooks/useDataQuery";
import { ask, STARTERS } from "@shared/agent/resolve";
import type { AgentAnswer, AgentTone } from "@shared/agent/types";

interface Turn {
  id: string;
  question: string;
  answer: AgentAnswer;
}

const TONE: Record<AgentTone, string> = {
  critical: "text-red-700 dark:text-red-400",
  warn: "text-amber-700 dark:text-amber-400",
  ok: "text-emerald-700 dark:text-emerald-400",
  neutral: "text-foreground",
};

function AnswerBlock({
  answer,
  onGo,
  onAsk,
}: {
  answer: AgentAnswer;
  onGo: (href: string) => void;
  onAsk: (question: string) => void;
}) {
  return (
    /*
     * `min-w-0` on every level, and it is not decoration.
     *
     * A flex or grid child defaults to `min-width: auto`, which means it
     * refuses to shrink below its content. One audit entry whose value is
     * "Projektblatt_G.011598624_Bruchenbr_cken_2026-08-23.pdf" — 52 characters
     * with nothing to break on — therefore widened the whole panel from the
     * inside. The reader got a horizontal scrollbar and an answer whose left
     * edge was off screen: "…derungshistorie, 0 davon kritisch."
     */
    <div className="min-w-0 space-y-2.5 rounded-xl border border-border bg-card p-3">
      <p className="text-xs font-semibold leading-snug break-words">{answer.headline}</p>

      {answer.facts.length > 0 && (
        <dl className="space-y-1">
          {answer.facts.map((f) => (
            <div
              key={`${f.label}-${f.value}`}
              // Two columns that can both shrink. The value gets what it needs
              // up to 60% and wraps inside that, instead of pushing the panel.
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,auto)] items-baseline gap-3"
            >
              <dt className="min-w-0 truncate text-2xs text-muted-foreground">{f.label}</dt>
              <dd
                className={`min-w-0 max-w-[60%] justify-self-end break-all text-right text-2xs font-semibold tabular-nums ${TONE[f.tone ?? "neutral"]}`}
              >
                {f.href ? (
                  <button
                    type="button"
                    onClick={() => onGo(f.href as string)}
                    className="rounded underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {f.value}
                  </button>
                ) : (
                  f.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {answer.actions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {answer.actions.map((a) => (
            <Button
              key={a.href + a.label}
              size="sm"
              variant="outline"
              onClick={() => onGo(a.href)}
              className="h-7 gap-1 px-2 text-2xs"
            >
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              {a.label}
            </Button>
          ))}
        </div>
      )}

      {/*
        * The conversation never ends.
        *
        * A reader who does not know what else to ask stops asking, and an
        * assistant nobody asks is a button. Every answer therefore hands back
        * the questions it leads to — built from this answer's own figures
        * where it can be (the Gewerk that came back worst, the station just
        * named), so the next question is about what was just read rather than
        * a fixed menu. Every one of them is proven to resolve; see
        * shared/agent/follow-ups.ts.
        */}
      {answer.followUps.length > 0 && (
        <div className="border-t border-border/60 pt-2">
          <p className="mb-1.5 text-2xs font-semibold text-muted-foreground">Weiterfragen</p>
          <ul className="flex flex-wrap gap-1.5">
            {answer.followUps.map((f) => (
              <li key={f.question}>
                <button
                  type="button"
                  data-follow-up="true"
                  onClick={() => onAsk(f.question)}
                  className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-2xs leading-tight transition-colors hover:border-primary/50 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {f.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Always shown. An answer whose derivation is hidden is an assertion. */}
      <p className="border-t border-border/60 pt-2 text-2xs leading-snug text-muted-foreground break-words">
        {answer.basis}
      </p>
    </div>
  );
}

export function AskBahn() {
  const [location, setLocation] = useLocation();
  const { data } = useAllData();
  const { data: audit } = useAuditLog();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const ctx = useMemo(
    () => ({ projects: data?.projects ?? [], audit: audit ?? [], today: Date.now() }),
    [data?.projects, audit],
  );

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const answer = ask(trimmed, ctx);
      setTurns((t) => [
        ...t,
        { id: `${Date.now()}-${t.length}`, question: trimmed, answer },
      ]);
      setQuestion("");
    },
    [ctx],
  );

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      setLocation(href);
    },
    [setLocation],
  );

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else launcherRef.current?.focus({ preventScroll: true });
  }, [open]);

  /*
   * The panel closes when the page changes, whoever changed it.
   *
   * Closing inside the click handler was not enough: the same click both closes
   * the panel and navigates, and the navigation re-renders the tree around this
   * component — leaving the panel sitting over the page it had just sent the
   * reader to. Keying the close to the location covers that, and also covers a
   * reader who navigates by the sidebar while the panel is open.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `location` is the trigger
  useEffect(() => {
    setOpen(false);
  }, [location]);

  // The transcript follows the newest answer without stealing the page scroll.
  useEffect(() => {
    if (turns.length > 0) endRef.current?.scrollIntoView({ block: "nearest" });
  }, [turns.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) setOpen(false);
      // Shift+? is the shortcut people try for help. It must not fire while
      // someone is typing into a field somewhere else on the page.
      const target = e.target as HTMLElement | null;
      const typing =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (!typing && e.key === "?" ) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {!open && (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Ask Bahn öffnen — Fragen zu Projekten, Prüfungen und Zahlen"
          /*
           * It breathes for as long as it is on screen.
           *
           * The first version stopped after the first question, on the theory
           * that an invitation is nagging once accepted. That was my call, not
           * the brief's, and the brief has now said twice that the assistant
           * pulses. At 3 s it is slower than a resting heartbeat, it animates
           * box-shadow only, and prefers-reduced-motion turns it off.
           */
          className="pulse-brand fixed bottom-5 right-5 z-40 flex h-12 items-center gap-2 rounded-full bg-primary px-4 text-primary-foreground shadow-lg transition-colors hover:bg-[hsl(354_100%_32%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <Bot className="h-5 w-5" aria-hidden="true" />
          <span className="text-sm font-semibold">Ask Bahn</span>
        </button>
      )}

      {open && (
        // <aside>, not role="dialog". The panel is deliberately non-modal: it
        // does not trap focus, the page behind it stays usable, and Escape
        // simply closes it. Announcing it as a dialog would promise a reader a
        // modal contract it does not keep — and <aside> already carries the
        // complementary role this needs.
        <aside
          aria-label="Ask Bahn"
          data-ask-bahn="open"
          // Declares this a floating layer to the UI audit: content beneath an
          // opaque overlay is covered on purpose, not text painted on text.
          data-overlay="true"
          className="fixed bottom-5 right-5 z-40 flex max-h-[min(34rem,80vh)] w-[min(24rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        >
          <header className="flex items-start gap-2 bg-primary p-4 text-primary-foreground">
            <Bot className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">Ask Bahn</p>
              <p className="text-2xs leading-snug opacity-90">
                Antworten aus Ihren Daten — jede Zahl wird berechnet, nicht geschätzt.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Ask Bahn schließen"
              className="rounded p-1 transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto overflow-x-hidden overscroll-contain p-3">
            {turns.length === 0 ? (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-2xs font-semibold text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  Womit kann ich helfen?
                </p>
                {STARTERS.map((s) => (
                  <button
                    key={s.question}
                    type="button"
                    onClick={() => send(s.question)}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-left text-xs transition-colors hover:border-primary/40 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            ) : (
              turns.map((t) => (
                <div key={t.id} className="min-w-0 space-y-2">
                  <p className="ml-auto w-fit max-w-[85%] break-words rounded-xl bg-muted px-3 py-1.5 text-xs">
                    {t.question}
                  </p>
                  <AnswerBlock answer={t.answer} onGo={go} onAsk={send} />
                </div>
              ))
            )}
            <div ref={endRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(question);
            }}
            className="flex items-center gap-2 border-t border-border p-3"
          >
            <input
              ref={inputRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              aria-label="Frage an Ask Bahn"
              placeholder="Was ist gerade kritisch?"
              className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-xs outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
            />
            <Button type="submit" size="sm" className="h-9 gap-1.5 px-3 text-2xs" disabled={!question.trim()}>
              <CornerDownLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Fragen
            </Button>
          </form>
        </aside>
      )}
    </>
  );
}

export default AskBahn;
