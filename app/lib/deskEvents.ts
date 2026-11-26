// One row per event on a queue page (M06): the first report of a cluster on the page heads it, and
// the cluster's other reports on that page fold under it, in page order. Reports of no cluster, or
// whose cluster has no other report on the page, stand alone.
export type Folded<T> = { readonly head: T; readonly members: readonly T[] };

type Clustered = { readonly ticketNumber: string; readonly cluster: { readonly tickets: readonly string[] } | null };

export function foldEvents<T extends Clustered>(items: readonly T[]): Folded<T>[] {
  const groups: { head: T; members: T[] }[] = [];
  const headOf = new Map<string, { head: T; members: T[] }>();
  for (const item of items) {
    const group = item.cluster?.tickets.map((ticket) => headOf.get(ticket)).find(Boolean);
    if (group) group.members.push(item);
    else {
      const own = { head: item, members: [] as T[] };
      groups.push(own);
      for (const ticket of item.cluster?.tickets ?? []) headOf.set(ticket, own);
    }
  }
  return groups;
}
