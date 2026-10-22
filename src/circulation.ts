import { validateOpenings } from "./openings";
import { openingSides, type Opening, type OpeningContext } from "./openings";
/** Logical regions stay unchanged. Only validated physical openings add edges. */
export function circulation(context: OpeningContext, openings: Opening[]) {
  validateOpenings(context, openings);
  const graph = new Map(context.regions.map((r) => [r.key, new Set<string>()])),
    entrances = new Set<string>();
  for (const o of openings) {
    const [a, b] = openingSides(context, o);
    if (o.host.kind === "exterior") {
      const room = a ?? b;
      if (room) entrances.add(room);
    } else if (a && b && a !== b) {
      graph.get(a)!.add(b);
      graph.get(b)!.add(a);
    }
  }
  const reachable = new Set(entrances),
    queue = [...entrances];
  for (let i = 0; i < queue.length; i++)
    for (const next of graph.get(queue[i]) ?? [])
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
  return {
    graph,
    entrances,
    reachable,
    unreachable: context.regions
      .filter((r) => !reachable.has(r.key))
      .map((r) => r.key),
  };
}
