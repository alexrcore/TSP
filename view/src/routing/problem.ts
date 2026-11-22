import type { GraphData } from '../graph'
import type { Route } from './solver'

export interface RoutingRequest {
  graph: GraphData
  capacities?: number[]
  initialRoutes?: string[][]
}

export function integers(values: number[], repetitions = 1): number[] | undefined {
  for (let scale = 1; scale <= 1e15; scale *= 10) {
    const scaled = values.map(value => Math.round(value * scale))
    if (scaled.every((n, i) => Number.isSafeInteger(n) && n / scale === values[i]) &&
      scaled.reduce((sum, n) => sum + Math.abs(n), 0) * repetitions < 2 ** 51) return scaled
  }
}

export function indexRoads(graph: GraphData) {
  const ids = new Map(graph.nodes.map((node, i) => [node.id, i]))
  const depot = ids.get(graph.start ?? graph.nodes[0]?.id)
  if (depot === undefined) throw new Error('Unknown start node.')
  const neighbors = graph.nodes.map(() => new Map<number, number>())
  graph.edges.forEach(({ source, target, weight }, i) => {
    const a = ids.get(source), b = ids.get(target)
    if (a === undefined || b === undefined || !Number.isFinite(weight) || weight < 0) throw new Error('Invalid road.')
    const prior = neighbors[a].get(b)
    if (a === b || (prior !== undefined && graph.edges[prior].weight <= weight)) return
    neighbors[a].set(b, i)
    neighbors[b].set(a, i)
  })
  const weight = (a: number, b: number) => graph.edges[neighbors[a].get(b) ?? -1]?.weight ?? Infinity
  return { graph, ids, depot, neighbors, weight }
}
export type Roads = ReturnType<typeof indexRoads>

/** A closed route cannot pass through the same customer twice. Only the depot
 * can join otherwise separate regions, and each region needs its own vehicle. */
export function hasRouteObstruction({ depot, neighbors }: Roads, capacities?: number[]) {
  const fleet = capacities?.length ?? 1
  if (fleet < 1 || fleet >= neighbors.length || neighbors.some(row => row.size < (capacities ? 1 : 2))) return true

  // Iterative low-link DFS finds articulation points without using the call stack.
  const discovered = new Uint32Array(neighbors.length)
  const low = new Uint32Array(neighbors.length)
  const stack = [{ at: depot, edges: neighbors[depot].keys() }]
  let visited = 1, regions = 0
  discovered[depot] = low[depot] = visited
  while (stack.length) {
    const { at, edges } = stack[stack.length - 1]
    const parent = stack[stack.length - 2]?.at
    const next = edges.next()
    if (next.done) {
      stack.pop()
      if (parent !== undefined) {
        if (parent !== depot && low[at] >= discovered[parent]) return true
        low[parent] = Math.min(low[parent], low[at])
      }
    } else if (!discovered[next.value]) {
      if (at === depot && ++regions > fleet) return true
      discovered[next.value] = low[next.value] = ++visited
      stack.push({ at: next.value, edges: neighbors[next.value].keys() })
    } else if (next.value !== parent) {
      low[at] = Math.min(low[at], discovered[next.value])
    }
  }
  return visited !== neighbors.length
}

/** Validate customer coverage, depot returns, roads and capacity before publishing a score. */
export function evaluate(roads: Roads, paths: number[][], capacities?: number[]) {
  const { depot, graph, neighbors } = roads
  if (paths.length !== (capacities?.length ?? 1)) return
  const seen = new Set<number>()
  const routes: Route[] = []
  let total = 0
  for (const [v, path] of paths.entries()) {
    if (path.length < (capacities ? 3 : 4) || path[0] !== depot || path.at(-1) !== depot) return
    let load = 0, cost = 0
    const edges: number[] = []
    for (let i = 1; i < path.length; i++) {
      const node = path[i], edge = neighbors[path[i - 1]]?.get(node)
      if (edge === undefined) return
      edges.push(edge)
      cost += graph.edges[edge].weight
      if (i < path.length - 1) {
        if (node === depot || seen.has(node)) return
        seen.add(node)
        load += graph.nodes[node].weight
      }
    }
    if (capacities && load > capacities[v]) return
    routes.push({ stops: path.map(i => graph.nodes[i].id), edges, cost })
    total += cost
  }
  if (seen.size === graph.nodes.length - 1 && Number.isFinite(total)) return { routes, cost: total }
}
