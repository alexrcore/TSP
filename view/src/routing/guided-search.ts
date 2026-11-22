import { clarkeWright } from './classical.ts'
import { evaluate } from './problem.ts'
import type { Roads } from './problem'
import type { RunResult } from './catalog'

function nearestTour(roads: Roads, deadline: number) {
  const { depot, neighbors, weight, graph } = roads
  const ordered = neighbors.map((row, i) => [...row.keys()].sort((a, b) => weight(i, a) - weight(i, b)))
  for (const first of ordered[depot]) {
    if (performance.now() >= deadline) break
    const path = [depot, first], visited = new Set(path)
    while (path.length < graph.nodes.length) {
      const next = ordered[path.at(-1)!].find(i => !visited.has(i))
      if (next === undefined) break
      path.push(next)
      visited.add(next)
    }
    const tour = evaluate(roads, [[...path, depot]])
    if (tour) return tour
  }
}

/** Guided local search using undirected road penalties, 2-opt and inter-vehicle relocations. */
export function guidedSearch(roads: Roads, capacities: number[] | undefined,
  seed: ReturnType<typeof evaluate>, deadline: number): RunResult {
  let best = seed
  if (!best) {
    if (capacities) {
      const initial = clarkeWright(roads, capacities, deadline)
      if ('routes' in initial) best = initial
    } else best = nearestTour(roads, deadline)
  }
  if (!best) return { status: 'unknown' }
  const { graph, neighbors, ids, depot } = roads
  const paths = best.routes.map(route => route.stops.map(id => ids.get(id)!))
  const loads = paths.map(path => path.slice(1, -1).reduce((sum, i) => sum + graph.nodes[i].weight, 0))
  const penalties = new Float64Array(graph.edges.length)
  const lambda = 0.15 * best.cost / best.routes.reduce((sum, r) => sum + r.edges.length, 0)
  const adjusted = (a: number, b: number) => {
    const edge = neighbors[a].get(b)
    return edge === undefined ? Infinity : graph.edges[edge].weight + lambda * penalties[edge]
  }

  while (lambda > 0 && performance.now() < deadline) {
    let bestDelta = 0, legalMoves = 0
    let move: (() => void) | undefined
    function consider(delta: number, apply: () => void) {
      if (!Number.isFinite(delta)) return
      legalMoves++
      if (delta < bestDelta) { bestDelta = delta; move = apply }
    }
    for (const [v, path] of paths.entries()) {
      for (let i = 1; i < path.length - 1 && performance.now() < deadline; i++) {
        const a = path[i - 1], b = path[i], c = path[i + 1]
        for (let j = i + 1; j < path.length - 1; j++) {
          const d = path[j], e = path[j + 1]
          if (a === depot && e === depot) continue // Reversing a whole undirected route changes no roads.
          consider(adjusted(a, d) + adjusted(b, e) - (adjusted(a, b) + adjusted(d, e)),
            () => { path.splice(i, j - i + 1, ...path.slice(i, j + 1).reverse()) })
        }
        if (path.length <= 3 || !neighbors[a].has(c)) continue
        const demand = graph.nodes[b].weight
        for (const [w, other] of paths.entries()) {
          if (w === v || loads[w] + demand > capacities![w]) continue
          for (let j = 1; j < other.length; j++) {
            const d = other[j - 1], e = other[j]
            const before = adjusted(a, b) + adjusted(b, c) + adjusted(d, e)
            consider(adjusted(a, c) + adjusted(d, b) + adjusted(b, e) - before, () => {
              path.splice(i, 1)
              other.splice(j, 0, b)
              loads[v] -= demand
              loads[w] += demand
            })
          }
        }
      }
    }
    if (move) {
      move()
      const candidate = evaluate(roads, paths, capacities)
      if (candidate && candidate.cost < best.cost) best = candidate
    } else {
      if (!legalMoves) break
      const edges = paths.flatMap(path => path.slice(1).map((node, i) => neighbors[path[i]].get(node)!))
      const utility = (edge: number) => graph.edges[edge].weight / (1 + penalties[edge])
      const max = edges.reduce((m, edge) => Math.max(m, utility(edge)), 0)
      for (const edge of new Set(edges)) if (utility(edge) === max) penalties[edge]++
    }
  }
  return { ...best, status: 'feasible' }
}
