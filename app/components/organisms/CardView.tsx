import type { Card } from "../../../src/contract/card";
import { ChoiceCard } from "./cards/ChoiceCards";
import { NeighbourhoodCard, NumberFormCard, TextQuestionCard } from "./cards/FormCards";
import { PlaceCard } from "./cards/PlaceCards";
import { CancelledCard, ConfirmCard, SentCard, SummaryCardView } from "./cards/SummaryCards";
import { ChronologyReviewCard, TimeCardView } from "./cards/TimeCards";

// The live card, drawn from its kind.
export function CardView({ card }: { readonly card: Card }) {
  switch (card.kind) {
    case "placeSearch":
    case "regencyVillages":
      return <PlaceCard card={card} />;
    case "neighbourhood":
      return <NeighbourhoodCard card={card} />;
    case "choice":
    case "multiChoice":
    case "chronologyStep":
      return <ChoiceCard card={card} />;
    case "numberForm":
      return <NumberFormCard card={card} />;
    case "timeCard":
      return <TimeCardView card={card} />;
    case "textQuestion":
      return <TextQuestionCard card={card} />;
    case "chronologyReview":
      return <ChronologyReviewCard card={card} />;
    case "summary":
      return <SummaryCardView card={card} />;
    case "confirm":
      return <ConfirmCard card={card} />;
    case "sent":
      return <SentCard card={card} />;
    default:
      return <CancelledCard card={card} />;
  }
}
