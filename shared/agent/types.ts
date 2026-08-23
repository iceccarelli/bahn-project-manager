/**
 * Ask Bahn — the assistant for this site.
 *
 * ---------------------------------------------------------------------------
 * Why this is not a chat box wired to a language model
 * ---------------------------------------------------------------------------
 * There is no model behind this app. server/_core/llm.ts exists, points at a
 * scaffold URL, requires an OPENAI_API_KEY that is not set, and is called by no
 * route; the client reads data.json and localStorage and never asks the server
 * anything. A widget that posted a question into that would spin forever, and a
 * widget that answered anyway would be inventing figures about 18,172 review
 * rows — which is the single thing this project has spent its whole life
 * removing.
 *
 * So the assistant answers from the data, deterministically. Every number it
 * says is computed by the same functions the Dashboard and the Gewerk tabs use,
 * on the spot, and every answer carries the derivation and a link to the screen
 * where it can be checked. It cannot hallucinate a number because it never
 * writes one — it only reports what a query returned.
 *
 * ---------------------------------------------------------------------------
 * Where a model fits, when there is one
 * ---------------------------------------------------------------------------
 * `AgentBackend` is the seam. Today `resolveLocally` matches an intent from the
 * question and runs a skill. With a model available, the model's job is to pick
 * the skill and phrase the sentence — never to produce the figures. The skills
 * stay the source of every number either way, because in a company where a
 * wrong figure moves a delivery date, the part that must not be probabilistic
 * is the arithmetic.
 */

export type AgentTone = "critical" | "warn" | "ok" | "neutral";

/** One measured value. `basis` says how it was derived, in the answer itself. */
export interface AgentFact {
  label: string;
  value: string;
  tone?: AgentTone;
  /** Where clicking this fact goes, when it is a set the reader can open. */
  href?: string;
}

export interface AgentAction {
  label: string;
  /** In-app route. Actions never leave the app except through an explicit link. */
  href: string;
  kind: "navigate" | "export" | "external";
}

/**
 * A question the reader can ask next, offered as a chip under the answer.
 *
 * The `question` is the exact text that goes back through `ask()`, not a
 * paraphrase of it. That is the whole contract: a chip that reads well but
 * resolves to "das habe ich nicht verstanden" is worse than no chip, so the
 * phrasing here is chosen to score unambiguously against one skill and a unit
 * test asserts every offered follow-up comes back `measured`.
 */
export interface AgentFollowUp {
  label: string;
  question: string;
}

export interface AgentAnswer {
  /** Which skill produced this, for the transcript and for tests. */
  intent: string;
  /** One sentence. Built from the facts, never written around them. */
  headline: string;
  facts: AgentFact[];
  actions: AgentAction[];
  /**
   * Where this answer leads. Never empty, and never the question just asked:
   * an answer that ends the conversation makes the reader guess what else the
   * assistant knows, and guessing is how people conclude it knows nothing.
   */
  followUps: AgentFollowUp[];
  /** What the figures were computed from. Always present. */
  basis: string;
  /**
   * "measured" — every figure came from a query over the loaded data.
   * "unknown"  — the question was not understood; the answer says so and offers
   *              what the assistant can do instead. It never guesses.
   */
  confidence: "measured" | "unknown";
}

export interface AgentReview {
  department: string;
  status?: string | null;
  prueferName?: string | null;
  pruefDatum?: string | null;
}

export interface AgentProject {
  id: number;
  projektnummer?: string | null;
  station?: string | null;
  bahnhofsmanagement?: string | null;
  projektbeschreibung?: string | null;
  projektleiter?: string | null;
  terminProjektvorstellung?: string | null;
  reviews?: AgentReview[] | null;
}

export interface AgentAuditEntry {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  details: string;
  meta?: {
    projektnummer?: string | null;
    station?: string | null;
    department?: string | null;
    field?: string | null;
    from?: string | null;
    to?: string | null;
    surface?: string | null;
  } | null;
}

export interface AgentContext {
  projects: readonly AgentProject[];
  audit: readonly AgentAuditEntry[];
  /** Pinned per turn so two facts in one answer cannot disagree about "today". */
  today: number;
}

/**
 * The seam a language model would slot into.
 *
 * Deliberately narrow: a backend chooses an intent and may rewrite the
 * headline. It is not given the ability to supply facts, because facts are the
 * part that has to be right.
 */
export interface AgentBackend {
  name: string;
  chooseIntent(question: string, available: readonly string[]): Promise<string | null>;
  rephrase?(headline: string, facts: readonly AgentFact[]): Promise<string>;
}
