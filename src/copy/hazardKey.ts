// A hazard's name in the catalogue. "other" is never offered to a reporter: it is what one tap
// stores, which tells no hazard.
export const hazardKey = (id: string) => (id === "other" ? "hazard.other.unknown" : `hazard.${id}.label`);
