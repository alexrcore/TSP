import { CpModel, CpSolver, CpSolverStatus, LinearExpr } from 'cpsat-js/portable'
import type { BoolVar } from 'cpsat-js/portable'
import { evaluate, indexRoads, integers } from './problem.ts'
import type { RoutingRequest } from './problem'
import { solveTsp, solveVrp } from './solver.ts'
import type { Solution } from './solver'

let engine: Promise<CpSolver> | undefined

export async function solveGraph({ graph, capacities, initialRoutes }: RoutingRequest, timeLimitMs = 1500): Promise<Solution> {
  const count = graph.nodes.length
  const fleet = capacities?.length ?? 1
  if (count < (capacities ? 2 : 3) || fleet < 1 || fleet >= count) return { status: 'infeasible' }
  const roads = indexRoads(graph)
  const { depot, neighbors } = roads
  if (neighbors.some(row => row.size < (capacities ? 1 : 2))) return { status: 'infeasible' }
  const legacy = (ms: number) => capacities
    ? solveVrp(graph, fleet, { capacities, initialRoutes, timeLimitMs: ms })
    : solveTsp(graph, { initialRoutes, timeLimitMs: ms })
  const demands = graph.nodes.map((n, i) => capacities && i !== depot ? n.weight : 0)
  if (demands.some(n => !Number.isFinite(n) || n < 0) || capacities?.some(n => !(n >= 0))) throw new Error('Invalid load.')
  const costs = integers(graph.edges.map(e => e.weight), fleet * 2)
  const loads = integers([...demands, ...(capacities ?? []).map(c => c === Infinity ? 0 : c)])
  if (!costs || !loads) return legacy(timeLimitMs)
  const plan = initialRoutes && evaluate(roads, initialRoutes.map(route => route.map(id => roads.ids.get(id) ?? -1)), capacities)
  const seed = plan && { ...plan, status: 'feasible' as const }
  if (timeLimitMs <= 0) return seed ?? { status: 'unknown' }
  const solver = await (engine ??= CpSolver.create())
  const deadline = performance.now() + timeLimitMs
  const model = new CpModel()
  const objective = new Map<number, bigint>()
  const assignments = graph.nodes.map(() => new Map<number, bigint>())
  const vehicleArcs = []
  for (let v = 0; v < fleet; v++) {
    const circuit: [number, number, BoolVar | number][] = []
    const moves: { from: number; to: number; edge: number; use: BoolVar }[] = []
    const cargo = new Map<number, bigint>()
    const tour = seed && 'routes' in seed ? seed.routes[v].stops : undefined
    const nextStop = tour && new Map(tour.slice(1).map((next, i) => [tour[i], next]))
    for (const [from, row] of neighbors.entries()) {
      if (from % 64 === 0 && performance.now() >= deadline) return seed ?? { status: 'unknown' }
      // The depot has no skip loop, so every vehicle must leave and return.
      if (capacities && from !== depot) {
        const visits = model.newBoolVar('')
        circuit.push([from, from, visits.not()])
        assignments[from].set(visits.index, 1n)
        cargo.set(visits.index, BigInt(loads[from]))
        if (nextStop) model.addHint(visits, Number(nextStop.has(graph.nodes[from].id)))
      }
      for (const [to, edge] of row) {
        const use = model.newBoolVar('')
        circuit.push([from, to, use])
        moves.push({ from, to, edge, use })
        objective.set(use.index, BigInt(costs[edge]))
        if (nextStop) model.addHint(use, Number(nextStop.get(graph.nodes[from].id) === graph.nodes[to].id))
      }
    }
    model.addCircuit(circuit)
    if (capacities && capacities[v] !== Infinity) model.add(new LinearExpr(cargo, 0n).le(loads[count + v]))
    vehicleArcs.push(moves)
  }
  if (capacities) assignments.forEach((terms, i) => {
    if (i !== depot) model.add(new LinearExpr(terms, 0n).equals(1))
  })
  model.minimize(new LinearExpr(objective, 0n))
  const remaining = deadline - performance.now()
  if (remaining <= 0) return seed ?? { status: 'unknown' }
  const result = solver.solve(model, { maxTimeInSeconds: remaining / 1000, numWorkers: 1 })
  if (result.status === CpSolverStatus.INFEASIBLE) return { status: 'infeasible' }
  if (result.status === CpSolverStatus.MODEL_INVALID) throw new Error('OR-Tools rejected the routing model.')
  if (result.status === CpSolverStatus.UNKNOWN) return seed ?? { status: 'unknown' }
  const routes = vehicleArcs.map(moves => {
    const successor = new Map(moves.filter(move => result.value(move.use)).map(move => [move.from, move]))
    const stops = [graph.nodes[depot].id], edges: number[] = []
    let at = depot, cost = 0
    do {
      const leg = successor.get(at)
      if (!leg || edges.length >= count) throw new Error('Incomplete OR-Tools circuit.')
      at = leg.to
      stops.push(graph.nodes[at].id)
      edges.push(leg.edge)
      cost += graph.edges[leg.edge].weight
    } while (at !== depot)
    return { stops, edges, cost }
  })
  const cost = routes.reduce((sum, route) => sum + route.cost, 0)
  if (result.status === CpSolverStatus.FEASIBLE && seed && 'cost' in seed && seed.cost < cost) return seed
  return { status: result.status === CpSolverStatus.OPTIMAL ? 'optimal' : 'feasible', routes, cost }
}
