import { createContext, useContext } from "react";
import { makeText, type Text } from "../../src/copy/text";

export const TextContext = createContext<Text>(makeText({}));

export const useText = () => useContext(TextContext);
