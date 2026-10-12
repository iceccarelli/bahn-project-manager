import type { AbnahmeAnswer, AbnahmeAnswers, AbnahmeHeader, ItemState } from "./types";

/** The pure state machine behind an Abnahme session; the hook only adds storage. */
export interface AbnahmeState {
  answers: AbnahmeAnswers;
  header: AbnahmeHeader;
}

export type AbnahmeAction =
  | { type: "status"; itemId: string; selected: AbnahmeAnswer }
  | { type: "mangel"; itemId: string; mangel: string }
  | { type: "header"; field: keyof AbnahmeHeader; value: string }
  | { type: "reset" };

export const MAX_MANGEL = 2000;

export function reduce(state: AbnahmeState, action: AbnahmeAction): AbnahmeState {
  switch (action.type) {
    case "status": {
      const prev = state.answers[action.itemId];
      // Leaving "Offen" drops the Mangel text: it is hidden on screen, and text
      // the Prüfer can no longer see must not reach a Mängelliste or a search hit.
      const next: ItemState = {
        selected: action.selected,
        mangel: action.selected === "Offen" ? (prev?.mangel ?? "") : "",
      };
      const { [action.itemId]: _removed, ...rest } = state.answers;
      return { ...state, answers: next.selected === null ? rest : { ...rest, [action.itemId]: next } };
    }
    case "mangel": {
      const prev = state.answers[action.itemId];
      if (prev?.selected !== "Offen") return state;
      return {
        ...state,
        answers: { ...state.answers, [action.itemId]: { selected: "Offen", mangel: action.mangel.slice(0, MAX_MANGEL) } },
      };
    }
    case "header":
      return { ...state, header: { ...state.header, [action.field]: action.value.slice(0, 200) } };
    case "reset":
      return { answers: {}, header: state.header };
  }
}

