import type { GraphData } from '../graph'
import { searchFleetPartition } from './fleet-partition.ts'
import { evaluate, indexRoads } from './problem.ts'
import type { Roads } from './problem'
import { reduceForcedRoads } from './forced-roads.ts'
import { matchingTour } from './cubic-tour.ts'

export interface Route {
  stops: string[]
  /** Original graph edge indices in travel order, including the return to the depot. */
  edges: number[]
  cost: number
}

export type Solution =
  | { status: 'optimal' | 'feasible'; routes: Route[]; cost: number }
  | { status: 'infeasible' | 'unknown' }

interface SearchOptions {
  timeLimitMs?: number
  initialRoutes?: string[][]
}

export function solveTsp(graph: GraphData, options: SearchOptions = {}): Solution {
  if (graph.nodes.length < 3) return { status: 'infeasible' }
  return optimize(graph, [Infinity], false, options)
}

export function solveVrp(graph: GraphData, vehicleCount: number,
  options: SearchOptions & { capacities?: number[] } = {}): Solution {
  if (!Number.isSafeInteger(vehicleCount) || vehicleCount < 1) throw new Error('Use a positive integer fleet size.')
  if (vehicleCount >= graph.nodes.length) return { status: 'infeasible' }
  const capacities = options.capacities ?? Array<number>(vehicleCount).fill(Infinity)
  if (capacities.length !== vehicleCount || capacities.some(c => !(c >= 0))) throw new Error('Check the fleet capacities.')
  return optimize(graph, capacities, true, options)
}

function optimize(graph: GraphData, capacities: number[], useDemand: boolean, options: SearchOptions): Solution {
  const deadline = performance.now() + (options.timeLimitMs ?? 1500)
  const { nodes, edges } = graph
  const indexed = indexRoads(graph)
  const { ids, depot: home, neighbors: roads, weight: cost } = indexed
  if (roads.some(row => row.size < (useDemand ? 1 : 2))) return { status: 'infeasible' }
  const demand = nodes.map((node, i) => useDemand && i !== home ? node.weight : 0)
  if (demand.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Customer demands must be nonnegative.')
  const fleet = capacities.length
  let best = Infinity
  let winner: number[][] | undefined

  // A generator can supply a feasible upper bound. Validate it like any other candidate.
  function accept(routes: number[][]) {
    if (routes.length !== fleet) return
    const served = new Set<number>()
    let total = 0
    for (const [k, stops] of routes.entries()) {
      if (stops.length < 3 || stops[0] !== home || stops.at(-1) !== home) return
      let load = 0
      for (let i = 1; i < stops.length; i++) {
        const a = stops[i - 1], b = stops[i]
        if (!roads[a]?.has(b)) return
        total += cost(a, b)
        if (i === stops.length - 1) continue
        if (b === home || served.has(b)) return
        served.add(b)
        load += demand[b]
      }
      if (load > capacities[k]) return
    }
    if (served.size === nodes.length - 1 && total < best) {
      best = total
      winner = routes.map(route => route.slice())
    }
  }
  if (options.initialRoutes) accept(options.initialRoutes.map(route => route.map(id => ids.get(id) ?? -1)))

  if (!useDemand && performance.now() < deadline) {
    const forced = reduceForcedRoads(indexed)
    if (forced) return forced
    const matching = matchingTour(indexed, deadline, winner)
    if (matching) return matching
  }
  if (fleet > 1 && demand.every(value => Number.isSafeInteger(value) && value <= Number.MAX_SAFE_INTEGER / nodes.length)) {
    const regional = solveDepotRegions(indexed, demand, capacities, deadline, winner)
    if (regional) return regional
  }
  const choices = roads.map((row, i) => [...row.keys()].sort((a, b) => cost(i, a) - cost(i, b)))
  const cheapest = choices.map((row, i) => cost(i, row[0]))

  // Improve the incumbent before branching, including moves between vehicles.
  if (winner) {
    const routes = winner.map(route => route.slice())
    const loads = routes.map(route => route.reduce((sum, i) => sum + demand[i], 0))
    let changed = true
    while (changed && performance.now() < deadline) {
      changed = false
      for (const [k, r] of routes.entries()) {
        for (let i = 1; i < r.length - 1 && performance.now() < deadline; i++) {
          for (let j = i + 1; j < r.length - 1; j++) {
            const reversed = cost(r[i - 1], r[j]) + cost(r[i], r[j + 1])
            const original = cost(r[i - 1], r[i]) + cost(r[j], r[j + 1])
            if (reversed < original) {
              r.splice(i, j - i + 1, ...r.slice(i, j + 1).reverse())
              changed = true
            }
          }
          if (r.length <= 3) continue
          const stop = r[i]
          const saving = cost(r[i - 1], stop) + cost(stop, r[i + 1]) - cost(r[i - 1], r[i + 1])
          if (!Number.isFinite(saving)) continue
          let moved = false
          for (const [v, other] of routes.entries()) {
            if (v === k || loads[v] + demand[stop] > capacities[v]) continue
            for (let j = 1; j < other.length; j++) {
              const extra = cost(other[j - 1], stop) + cost(stop, other[j]) - cost(other[j - 1], other[j])
              if (extra >= saving) continue
              r.splice(i, 1)
              other.splice(j, 0, stop)
              loads[k] -= demand[stop]
              loads[v] += demand[stop]
              moved = changed = true
              break
            }
            if (moved) break
          }
        }
      }
      if (changed) accept(routes)
    }
  }

  // Depth-first branch and bound over unused customers and vehicle returns.
  // Every completion must pay for one outgoing road at each remaining stop.
  // Use that incremental bound only when the arithmetic is exact.
  const integerBound = edges.every(e => Number.isSafeInteger(e.weight) &&
    e.weight <= Number.MAX_SAFE_INTEGER / (nodes.length + fleet + 1))
  const lower = integerBound ? cheapest : cheapest.map(() => 0)
  // Every unvisited TSP vertex still needs two distinct incident roads. Only
  // the ends of the current path need one each. Divide by two for edge sharing.
  const pairBound = !useDemand && integerBound && edges.every(e => e.weight <= Number.MAX_SAFE_INTEGER / (2 * (nodes.length + 1)))
  const pairs = pairBound ? choices.map((row, i) => cheapest[i] + cost(i, row[1])) : undefined
  function openEnd(at: number, used: number | undefined) {
    return choices[at][0] === used ? cost(at, choices[at][1]) : cheapest[at]
  }
  const bits = nodes.map((_, i) => 1n << BigInt(i))
  const path: number[] = []
  const memo = new Map<string, number>()
  let expired = false
  let iterations = 0
  type Frame = { at: number; visited: bigint; left: number; vehicle: number; load: number; spent: number; bound: number; choice: number }
  function search(initialBound: number) {
    // Store the traversal on the heap. Long tours and many depot returns can exceed the JS call stack.
    const stack: Frame[] = []
    function enter(at: number, visited: bigint, left: number, vehicle: number, load: number, spent: number, bound: number) {
      const remaining = pairs ? Math.ceil((bound + (at === home ? pairs[home] :
        openEnd(at, path.at(-1)) + openEnd(home, path[1] ?? at))) / 2) : bound
      if (spent + remaining >= best) return
      const key = visited + ':' + at + ':' + vehicle + ':' + load
      if ((memo.get(key) ?? Infinity) <= spent) return
      if (memo.size >= 120000) memo.clear()
      memo.set(key, spent)
      stack.push({ at, visited, left, vehicle, load, spent, bound: pairs ? bound : bound - lower[at], choice: 0 })
      path.push(at)
    }
    enter(home, bits[home], nodes.length - 1, 0, 0, 0, initialBound)
    while (stack.length) {
      if ((iterations++ & 255) === 0 && performance.now() >= deadline) { expired = true; return }
      const frame = stack[stack.length - 1]
      if (frame.choice === choices[frame.at].length) {
        stack.pop()
        path.pop()
        continue
      }
      const next = choices[frame.at][frame.choice++]
      const nextCost = frame.spent + cost(frame.at, next)
      const later = fleet - frame.vehicle - 1
      if (next === home) {
        if (frame.left < later || (later === 0 && frame.left > 0)) continue
        if (later > 0) enter(home, frame.visited, frame.left, frame.vehicle + 1, 0, nextCost, frame.bound)
        else if (nextCost < best) {
          const routes: number[][] = []
          let start = 0
          for (let i = 1; i < path.length; i++) {
            if (path[i] === home) { routes.push(path.slice(start, i + 1)); start = i }
          }
          routes.push([...path.slice(start), home])
          accept(routes)
        }
      } else if (frame.left > later && !(frame.visited & bits[next]) && frame.load + demand[next] <= capacities[frame.vehicle]) {
        enter(next, frame.visited | bits[next], frame.left - 1, frame.vehicle, frame.load + demand[next], nextCost,
          frame.bound - (pairs?.[next] ?? 0))
      }
    }
  }
  const covered = useDemand && fleet > 1 && integerBound &&
    demand.every(value => Number.isSafeInteger(value) && value <= Number.MAX_SAFE_INTEGER / nodes.length) &&
    searchFleetPartition(home, choices, demand, capacities, cost, deadline, () => best, accept)
  if (!covered) {
    const initialBound = pairs ? pairs.reduce((sum, value, i) => i === home ? sum : sum + value, 0) :
      lower.reduce((sum, value) => sum + value, 0) + (fleet - 1) * lower[home]
    search(initialBound)
  }
  if (!winner) return { status: expired ? 'unknown' : 'infeasible' }
  const routes = winner.map(stops => {
    const indices = stops.slice(1).map((to, i) => roads[stops[i]].get(to)!)
    return { stops: stops.map(i => nodes[i].id), edges: indices, cost: indices.reduce((sum, i) => sum + edges[i].weight, 0) }
  })
  return { status: expired ? 'feasible' : 'optimal', cost: best, routes }
}

function solveDepotRegions(roads: Roads, demand: number[], capacities: number[], deadline: number,
  seed?: number[][]): Solution | undefined {
  const { graph, depot, ids, neighbors } = roads
  const regionOf = new Int32Array(neighbors.length).fill(-1)
  const regions: { customers: number[]; load: number; edges: GraphData['edges']; seed?: string[] }[] = []
  for (let first = 0; first < neighbors.length; first++) {
    if (first === depot || regionOf[first] !== -1) continue
    if (regions.length === capacities.length) return { status: 'infeasible' }
    const customers = [first]
    regionOf[first] = regions.length
    let load = 0
    for (const customer of customers) {
      load += demand[customer]
      for (const next of neighbors[customer].keys()) {
        if (next === depot || regionOf[next] !== -1) continue
        regionOf[next] = regions.length
        customers.push(next)
      }
    }
    regions.push({ customers, load, edges: [] })
  }
  if (regions.length !== capacities.length) return

  // Each truck can enter just one region. Matching sorted loads to sorted
  // capacities is sufficient because the road costs are identical for all trucks.
  for (const path of seed ?? []) regions[regionOf[path[1]]].seed = path.map(i => graph.nodes[i].id)
  for (const edge of graph.edges) {
    const from = ids.get(edge.source)!, to = ids.get(edge.target)!
    if (from !== to) regions[regionOf[from === depot ? to : from]].edges.push(edge)
  }
  regions.sort((a, b) => a.load - b.load)
  const fleet = capacities.map((capacity, vehicle) => ({ capacity, vehicle })).sort((a, b) => a.capacity - b.capacity)
  if (regions.some((region, i) => region.load > fleet[i].capacity)) return { status: 'infeasible' }
  const paths: number[][] = []
  let optimal = true
  for (const [i, region] of regions.entries()) {
    const { customers } = region
    if (customers.length === 1) {
      if (!neighbors[depot].has(customers[0])) return { status: 'infeasible' }
      paths[fleet[i].vehicle] = [depot, customers[0], depot]
      continue
    }
    const subgraph = { start: graph.nodes[depot].id, nodes: [graph.nodes[depot], ...customers.map(j => graph.nodes[j])], edges: region.edges }
    const result = solveTsp(subgraph, { initialRoutes: region.seed && [region.seed],
      timeLimitMs: Math.max(0, deadline - performance.now()) / (regions.length - i) })
    if (!('routes' in result)) return result
    optimal &&= result.status === 'optimal'
    paths[fleet[i].vehicle] = result.routes[0].stops.map(id => ids.get(id)!)
  }
  const verified = evaluate(roads, paths, capacities)
  if (!verified) throw new Error('Invalid regional route assignment.')
  return { ...verified, status: optimal ? 'optimal' : 'feasible' }
}
