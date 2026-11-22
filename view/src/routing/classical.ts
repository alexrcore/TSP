import { evaluate } from './problem.ts'
import type { Roads } from './problem'
import type { RunResult } from './catalog'

/** Held–Karp over reachable (visited set, endpoint) states; a layer adds one stop. */
export function heldKarp(roads: Roads, deadline: number, seed?: ReturnType<typeof evaluate>): RunResult {
  const { graph, depot, neighbors, weight } = roads
  const count = graph.nodes.length
  if (count < 3 || neighbors.some(row => row.size < 2)) return { status: 'infeasible' }
  type State = { mask: bigint; last: number; cost: number; parent?: State }
  const bits = graph.nodes.map((_, i) => 1n << BigInt(i))
  const start: State = { mask: bits[depot], last: depot, cost: 0 }
  const radix = BigInt(count)
  let layer = new Map([[0n, start]])
  let best = seed
  for (let visited = 1; visited < count && layer.size; visited++) {
    const next = new Map<bigint, State>()
    for (const previous of layer.values()) {
      if (performance.now() >= deadline) return best ? { ...best, status: 'feasible' } : { status: 'unknown' }
      for (const [last, edge] of neighbors[previous.last]) {
        if (previous.mask & bits[last]) continue
        const cost = previous.cost + graph.edges[edge].weight
        if (cost >= (best?.cost ?? Infinity)) continue
        if (visited === count - 1) {
          if (cost + weight(last, depot) >= (best?.cost ?? Infinity)) continue
          const path = [depot, last]
          for (let state: State | undefined = previous; state; state = state.parent) path.push(state.last)
          best = evaluate(roads, [path.reverse()])
        } else {
          const mask = previous.mask | bits[last]
          const key = mask * radix + BigInt(last)
          if (cost < (next.get(key)?.cost ?? Infinity)) next.set(key, { mask, last, cost, parent: previous })
        }
      }
    }
    layer = next
  }
  return best ? { ...best, status: 'optimal' } : { status: 'infeasible' }
}
/** Parallel savings merges, prioritizing the removal of missing depot links on sparse graphs. */
export function clarkeWright(roads: Roads, capacities: number[], deadline: number): RunResult {
  const { graph, depot, neighbors, weight } = roads
  const fleet = capacities.map((capacity, vehicle) => ({ capacity, vehicle })).sort((a, b) => a.capacity - b.capacity)
  const customers = graph.nodes.map((_, i) => i).filter(i => i !== depot)
  if (!fleet.length || fleet.length > customers.length) return { status: 'infeasible' }
  const groups = new Map(customers.map(i => [i, { stops: [i], load: graph.nodes[i].weight }]))
  const owner = new Map(customers.map(i => [i, i]))
  const savings = customers.flatMap(i => [...neighbors[i].keys()].filter(j => j !== depot && i < j).map(j => {
    const a = weight(depot, i), b = weight(depot, j)
    return { i, j, missing: Number(a === Infinity) + Number(b === Infinity),
      gain: (Number.isFinite(a) ? a : 0) + (Number.isFinite(b) ? b : 0) - weight(i, j) }
  })).sort((a, b) => b.missing - a.missing || b.gain - a.gain)
  for (const { i, j } of savings) {
    if (performance.now() >= deadline || groups.size === fleet.length) break
    const leftId = owner.get(i)!, rightId = owner.get(j)!
    if (leftId === rightId) continue
    const left = groups.get(leftId)!, right = groups.get(rightId)!
    if ((left.stops[0] !== i && left.stops.at(-1) !== i) || (right.stops[0] !== j && right.stops.at(-1) !== j)) continue
    const load = left.load + right.load
    if (load > fleet.at(-1)!.capacity) continue
    if (left.stops.at(-1) !== i) left.stops.reverse()
    if (right.stops[0] !== j) right.stops.reverse()
    left.stops = left.stops.concat(right.stops)
    left.load = load
    for (const customer of right.stops) owner.set(customer, leftId)
    groups.delete(rightId)
  }
  if (groups.size !== fleet.length) return { status: 'unknown' }
  const paths: number[][] = []
  const ordered = [...groups.values()].sort((a, b) => a.load - b.load)
  ordered.forEach((group, i) => { paths[fleet[i].vehicle] = [depot, ...group.stops, depot] })
  const result = evaluate(roads, paths, capacities)
  return result ? { ...result, status: 'feasible' } : { status: 'unknown' }
}
