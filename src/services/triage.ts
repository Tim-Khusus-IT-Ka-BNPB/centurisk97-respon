import type { PhotoRecord } from "../adapters/postgres/photos";
import { numberHistory, otherReporters, reporterLines } from "../adapters/postgres/triage";
import type { FieldStates } from "../domain/fieldState";
import { chosenHazardType, completePercent } from "../domain/fields/applicable";
import { HOUR_MS } from "../domain/time";
import { lifeAtRiskOf, livePhotoCount, type ModelJudgement, placeSignal, type Triage, triage } from "../domain/triage";
import { type TriageInput, triageInput, triageRequest, validateJudgement } from "../domain/triageRequest";
import type { ServiceBindings } from "./bindings";
import { MODEL_DEADLINE_MS, withinDeadline } from "./extract";

type Sending = {
  readonly draftId: string;
  readonly numberKey: string;
  readonly villageCode: string;
  readonly states: FieldStates;
  readonly emergency: boolean;
  readonly photos: readonly PhotoRecord[];
};

async function judgement(bindings: ServiceBindings, input: TriageInput): Promise<ModelJudgement | null> {
  if (bindings.settings.model.mode === "off") return null;
  const signal = AbortSignal.timeout(MODEL_DEADLINE_MS);
  return validateJudgement(
    await withinDeadline(bindings.model.extract(triageRequest(input), signal), MODEL_DEADLINE_MS),
  );
}

// How sure the desk can be of a report being sent: code reads the signals, the model reads the words.
export async function triageOnSend(bindings: ServiceBindings, sending: Sending): Promise<Triage> {
  const nowMs = bindings.clock.now();
  const [others, history, words] = await Promise.all([
    otherReporters(bindings.db, {
      hazardType: String(chosenHazardType(sending.states)),
      districtCode: sending.villageCode.slice(0, 8),
      numberKey: sending.numberKey,
      since: new Date(nowMs - 24 * HOUR_MS),
    }),
    numberHistory(bindings.db, sending.numberKey),
    reporterLines(bindings.db, sending.draftId),
  ]);
  return triage({
    lifeAtRisk: lifeAtRiskOf(sending.states, sending.emergency),
    place: placeSignal(sending.states, sending.photos),
    livePhotos: livePhotoCount(sending.photos),
    otherReporters: others,
    history,
    completePercent: completePercent(sending.states),
    model: await judgement(bindings, triageInput(sending.states, words, nowMs)),
  });
}
