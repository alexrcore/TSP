import type { SolverId, RunResult } from './catalog'
import { clarkeWright, heldKarp } from './classical.ts'
import { guidedSearch } from './guided-search.ts'
import { evaluate, hasRouteObstruction, indexRoads, integers } from './problem.ts'
import type { RoutingRequest } from './problem'
import { solveTsp, solveVrp } from './solver.ts'

export async function runSolver(id: SolverId, request: RoutingRequest, ms = 1500): Promise<RunResult> {
  const { graph, capacities, initialRoutes } = request
  if (graph.nodes.length < (capacities ? 2 : 3)) return { status: 'infeasible' }
  const roads = indexRoads(graph)
  const indices = (paths: string[][]) => paths.map(path => path.map(stop => roads.ids.get(stop) ?? -1))
  const seed = initialRoutes && evaluate(roads, indices(initialRoutes), capacities)
  if (!seed && hasRouteObstruction(roads, capacities)) return { status: 'infeasible' }
  let result: RunResult
  switch (id) {
    case 'guided': result = guidedSearch(roads, capacities, seed, performance.now() + ms); break
    case 'highs': result = await (await import('./highs.ts')).solveHighs(roads, capacities, ms); break
    case 'cp-sat': {
      // Comparisons must not silently attribute a TypeScript fallback to OR-Tools.
      const demand = graph.nodes.map((node, i) => capacities && i !== roads.depot ? node.weight : 0)
      if (!integers(graph.edges.map(e => e.weight), 2 * (capacities?.length ?? 1)) ||
          !integers([...demand, ...(capacities ?? []).map(c => c === Infinity ? 0 : c)])) return { status: 'unsupported' }
      result = await (await import('./or-tools.ts')).solveGraph(request, ms)
      break
    }
    case 'custom': result = capacities
      ? solveVrp(graph, capacities.length, { capacities, initialRoutes, timeLimitMs: ms })
      : solveTsp(graph, { initialRoutes, timeLimitMs: ms }); break
    case 'held-karp': result = heldKarp(roads, performance.now() + ms, seed); break
    case 'savings': result = clarkeWright(roads, capacities!, performance.now() + ms); break
  }
  if (result.status === 'infeasible' && seed) return { status: 'error' }
  if ('routes' in result) {
    const verified = evaluate(roads, indices(result.routes.map(route => route.stops)), capacities)
    if (!verified) return { status: 'error' }
    if (result.status === 'optimal' || !seed || verified.cost < seed.cost) return { ...verified, status: result.status }
  }
  if (seed && (result.status === 'feasible' || result.status === 'unknown')) {
    return { ...seed, status: 'feasible', startingPlan: true }
  }
  return result
}
