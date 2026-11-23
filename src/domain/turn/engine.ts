import { canMove, type DraftState } from "../draftStates";
import type { Extraction } from "../extraction";
import type { PlaceValue } from "../fieldState";
import type { GroupId } from "../fields/catalogue";
import type { FieldError } from "../identityForm";
import { BACK_STEPS } from "../limits";
import type { MaskedText } from "../masking";
import { OFF_TOPIC_LIMIT, type TopicVerdict } from "../topicGate";
import { type AnswerContext, applyAnswer, type CardAnswer } from "./answer";
import type { AskedCounts, DraftContent, Question } from "./content";
import { applyStory } from "./freeText";
import { nextQuestion, stateFor } from "./next";

export type DraftSnapshot = {
  readonly state: DraftState;
  readonly content: DraftContent;
  readonly asked: AskedCounts;
  // The last history line before the step this snapshot undoes; kept by the service.
  readonly transcriptSeq?: number;
};

export type TurnDraft = DraftSnapshot & {
  readonly backStack: readonly DraftSnapshot[];
  readonly offTopicCount: number;
  readonly templatesOnly: boolean;
};

export type TurnInput =
  | { readonly kind: "answer"; readonly answer: CardAnswer; readonly village: PlaceValue | null }
  | { readonly kind: "story"; readonly message: MaskedText; readonly extraction: Extraction }
  | { readonly kind: "refused"; readonly topic: TopicVerdict }
  | { readonly kind: "back" }
  | { readonly kind: "editGroup"; readonly groupId: GroupId }
  | { readonly kind: "cancel" }
  | { readonly kind: "confirm" }
  | { readonly kind: "dismiss" };

type TurnNotice =
  | { readonly kind: "refusal"; readonly copyKey: string }
  | { readonly kind: "danger"; readonly copyKey: string }
  | { readonly kind: "lifeLine" };

export type TurnOutcome =
  | {
      readonly kind: "next";
      readonly draft: TurnDraft;
      readonly question: Question;
      readonly notices: readonly TurnNotice[];
    }
  | { readonly kind: "cancelled" }
  | { readonly kind: "invalid"; readonly errors: readonly FieldError[] }
  | { readonly kind: "backRefused"; readonly code: "draft.nothingToUndo" | "draft.backLimit" }
  | { readonly kind: "stale" };

export function currentQuestion(draft: DraftSnapshot): Question {
  return nextQuestion(draft.state, draft.content, draft.asked);
}

// Moves the draft to the question code picks next. A danger warning shows once, under that question.
function settle(draft: TurnDraft, notices: TurnNotice[]): TurnOutcome {
  const question = nextQuestion(draft.state, draft.content, draft.asked);
  const state = stateFor(question, draft.state);
  if (state !== draft.state && !canMove(draft.state, state)) throw new Error(`No move from ${draft.state} to ${state}`);
  if (draft.content.danger) notices.push({ kind: "danger", copyKey: draft.content.danger });
  if (question.kind === "summary") notices.push({ kind: "lifeLine" });
  return { kind: "next", draft: { ...draft, state, content: { ...draft.content, danger: null } }, question, notices };
}

function remembered(draft: TurnDraft, content: DraftContent, asked: AskedCounts): TurnDraft {
  const snapshot: DraftSnapshot = { state: draft.state, content: draft.content, asked: draft.asked };
  return { ...draft, content, asked, backStack: [...draft.backStack, snapshot].slice(-BACK_STEPS) };
}

const hasAnswers = (content: DraftContent) =>
  Object.keys(content.states).length > 0 || (content.chronology?.steps.length ?? 0) > 0;

function goBack(draft: TurnDraft): TurnOutcome {
  if (draft.content.overlay) return settle({ ...draft, content: { ...draft.content, overlay: null } }, []);
  const previous = draft.backStack.at(-1);
  if (!previous)
    return { kind: "backRefused", code: hasAnswers(draft.content) ? "draft.backLimit" : "draft.nothingToUndo" };
  return settle({ ...draft, ...previous, backStack: draft.backStack.slice(0, -1) }, []);
}

function refuse(draft: TurnDraft, topic: TopicVerdict): TurnOutcome {
  const offTopicCount = draft.offTopicCount + 1;
  const notices: TurnNotice[] = [{ kind: "refusal", copyKey: `refusal.${topic}` }];
  const templatesOnly = draft.templatesOnly || offTopicCount >= OFF_TOPIC_LIMIT;
  if (templatesOnly && !draft.templatesOnly) notices.push({ kind: "refusal", copyKey: "refusal.templatesOnly" });
  return settle({ ...draft, offTopicCount, templatesOnly, content: { ...draft.content, danger: null } }, notices);
}

// One turn of the conversation, pure. The model's part arrives already checked as an extraction;
// everything about what comes next is decided here.
export function runTurn(draft: TurnDraft, input: TurnInput, context: AnswerContext): TurnOutcome {
  const question = currentQuestion(draft);
  switch (input.kind) {
    case "back":
      return goBack(draft);
    case "cancel":
      return settle({ ...draft, content: { ...draft.content, overlay: { kind: "cancelConfirm" }, danger: null } }, []);
    case "confirm":
      return question.kind === "cancelConfirm" ? { kind: "cancelled" } : { kind: "stale" };
    case "dismiss":
      return draft.content.overlay ? goBack(draft) : { kind: "stale" };
    case "editGroup":
      if (question.kind !== "summary") return { kind: "stale" };
      return settle(
        { ...draft, content: { ...draft.content, overlay: { kind: "edit", groupId: input.groupId, done: [] } } },
        [],
      );
    case "refused":
      return refuse(draft, input.topic);
    case "story": {
      // The model's label refuses a message only when no checked value of it survives: code holds the flow.
      const kept = Object.keys(input.extraction.fields).length + input.extraction.hazardGuesses.length;
      if (input.extraction.topic !== "disaster" && kept === 0)
        return refuse(draft, input.extraction.topic === "dataRequest" ? "dataRequest" : "offTopic");
      if (question.kind === "cancelConfirm") return settle(draft, []);
      const result = applyStory(question, draft.content, draft.asked, input.message, input.extraction, context);
      if (result.kind === "invalid") return result;
      const notices: TurnNotice[] = input.extraction.lifeAtRisk ? [{ kind: "lifeLine" }] : [];
      return settle(remembered(draft, result.content, result.asked), notices);
    }
    default: {
      const result = applyAnswer(question, input.answer, draft.content, draft.asked, context, input.village);
      if (result.kind !== "applied") return result;
      return settle(remembered(draft, result.content, result.asked as AskedCounts), []);
    }
  }
}
