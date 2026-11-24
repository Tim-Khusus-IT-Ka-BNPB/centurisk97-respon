import { createContext, useContext } from "react";
import { createCatalogue } from "../../src/copy/catalogue";

// The page's share of the copy catalogue, picked on the server and handed over by the loader.
export type Texts = Readonly<Record<string, string>>;
type Params = Readonly<Record<string, string | number>>;

export type Text = {
  has(key: string): boolean;
  // A key with its params. A param that is itself a copy key (a field label, an option) is looked up first.
  (key: string, params?: Params): string;
  // The per-hazard variant ("field.farmland.label.flood") when it exists, else the base key.
  variant(key: string, hazardType: string | null): string;
};

export function makeText(texts: Texts): Text {
  const catalogue = createCatalogue({ page: texts });
  const resolve = (params: Params): Params =>
    Object.fromEntries(
      Object.entries(params).map(([name, value]) => [
        name,
        typeof value === "string" && catalogue.has(value) ? catalogue.text(value) : value,
      ]),
    );
  const text = ((key: string, params: Params = {}) => catalogue.format(key, resolve(params))) as Text;
  text.has = catalogue.has;
  text.variant = (key, hazardType) => {
    const variant = `${key}.${hazardType}`;
    return hazardType !== null && catalogue.has(variant) ? variant : key;
  };
  return text;
}

export const TextContext = createContext<Text>(makeText({}));

export const useText = () => useContext(TextContext);
