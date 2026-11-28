// The site menu's item for a page: the home only on itself, any other also on the pages under it.
export const isCurrent = (pathname: string, to: string): boolean =>
  to === "/" ? pathname === "/" : pathname.startsWith(to);
