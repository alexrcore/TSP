import { evaluate } from './problem.ts'
import type { Roads } from './problem'
import type { Solution } from './solver'

/** Simplify a private, undirected TSP road index while preserving every possible tour. */
export function reduceForcedRoads(roads: Roads): Solution | undefined {
  const { graph, depot, neighbors } = roads
  const queue: number[] = []
  for (let i = 0; i < neighbors.length; i++) if (neighbors[i].size === 2) queue.push(i)
  if (!queue.length) return
  const forced = new Uint8Array(graph.edges.length)
  const incident = new Uint8Array(neighbors.length)
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]
    if (neighbors[node].size === 2) {
      for (const [next, edge] of neighbors[node]) {
        if (forced[edge]) continue
        forced[edge] = 1
        for (const at of [node, next]) {
          if (++incident[at] > 2) return { status: 'infeasible' }
          if (incident[at] === 2 && neighbors[at].size > 2) queue.push(at)
        }
      }
    }
    if (incident[node] === 2) {
      for (const [next, edge] of neighbors[node]) {
        if (forced[edge]) continue
        neighbors[node].delete(next)
        neighbors[next].delete(node)
        if (neighbors[next].size < 2) return { status: 'infeasible' }
        if (neighbors[next].size === 2) queue.push(next)
      }
    }
  }
  if (!neighbors.every(row => row.size === 2)) return
  const path = [depot]
  let previous = -1, at = depot
  do {
    const [a, b] = neighbors[at].keys()
    const next = a === previous ? b : a
    path.push(next)
    previous = at
    at = next
  } while (at !== depot)
  if (path.length !== neighbors.length + 1) return { status: 'infeasible' }
  const result = evaluate(roads, [path])
  return result ? { ...result, status: 'optimal' } : { status: 'unknown' }
}
